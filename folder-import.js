/*
 * VisionFlow folder import helper
 *
 * Browser-only, dependency-free helper for <input type="file" webkitdirectory>.
 * It deliberately uses data: URLs (never blob: URLs), so the returned document can
 * be assigned to a preview/editor opened from file:// without a web server.
 *
 * Public contract:
 *   window.VFFolder.prepare(files, entryPath?) -> Promise<{
 *     html: string,
 *     pages: Array<{ path: string, name: string }>,
 *     entryPath: string,
 *     warnings: string[],
 *     externalResources: Array<{url:string,kind:string,reference:string}>
 *   }>
 *
 * `pages` lists every discovered HTML file.  Only `entryPath` is read and
 * transformed into `html`; callers can call prepare again to switch pages.
 * JavaScript is never run by this helper.  Script tags in returned HTML are made
 * inert (type="application/x-vf-disabled-script") as a defense in depth measure;
 * the editor preview should also keep scripts disabled by default.
 */
(function attachVFFolder(global) {
  'use strict';

  var DATA_DISABLED_SCRIPT_TYPE = 'application/x-vf-disabled-script';
  var MIME_BY_EXTENSION = {
    css: 'text/css;charset=utf-8',
    html: 'text/html;charset=utf-8', htm: 'text/html;charset=utf-8',
    js: 'text/javascript;charset=utf-8', mjs: 'text/javascript;charset=utf-8',
    json: 'application/json;charset=utf-8', map: 'application/json;charset=utf-8',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
    bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
    mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mp3: 'audio/mpeg',
    wav: 'audio/wav', oga: 'audio/ogg', ogg: 'audio/ogg',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    eot: 'application/vnd.ms-fontobject', pdf: 'application/pdf'
  };

  function slashPath(value) {
    return String(value || '').replace(/\\/g, '/');
  }

  // Normalize only virtual folder paths. It intentionally has no filesystem access.
  function normalizePath(value) {
    var path = slashPath(value).replace(/^\.\//, '').replace(/^\/+/, '');
    var parts = path.split('/');
    var output = [];
    for (var i = 0; i < parts.length; i += 1) {
      var part = parts[i];
      if (!part || part === '.') continue;
      if (part === '..') {
        if (output.length) output.pop();
        continue;
      }
      output.push(part);
    }
    return output.join('/');
  }

  function dirname(path) {
    var clean = normalizePath(path);
    var index = clean.lastIndexOf('/');
    return index < 0 ? '' : clean.slice(0, index);
  }

  function basename(path) {
    var clean = normalizePath(path);
    var index = clean.lastIndexOf('/');
    return index < 0 ? clean : clean.slice(index + 1);
  }

  function extension(path) {
    var name = basename(path);
    var index = name.lastIndexOf('.');
    return index < 0 ? '' : name.slice(index + 1).toLowerCase();
  }

  function isHtmlPath(path) {
    return /\.html?$/i.test(path);
  }

  function isRemoteOrSpecialUrl(value) {
    var url = String(value || '').trim();
    // This includes http(s), data, hash-only URLs, protocol-relative URLs, mailto,
    // javascript, file, and every other URI scheme. None are folder resources.
    return !url || url.charAt(0) === '#' || url.charAt(0) === '?' ||
      /^\/\//.test(url) || /^[a-z][a-z0-9+.-]*:/i.test(url);
  }

  function splitUrl(value) {
    var url = String(value || '').trim();
    var hashIndex = url.indexOf('#');
    var beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
    var hash = hashIndex === -1 ? '' : url.slice(hashIndex);
    var queryIndex = beforeHash.indexOf('?');
    return {
      pathname: queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex),
      // A query describes the original fetched URL and has no equivalent after
      // inlining. Fragments are retained (notably for SVG symbol references).
      fragment: hash
    };
  }

  function safelyDecodePath(path) {
    try {
      return decodeURIComponent(path);
    } catch (_) {
      return path;
    }
  }

  function resolveVirtualPath(baseDirectory, relativePath) {
    var input = slashPath(safelyDecodePath(relativePath));
    if (input.charAt(0) === '/') return normalizePath(input);
    return normalizePath((baseDirectory ? baseDirectory + '/' : '') + input);
  }

  function toArray(files) {
    if (!files || typeof files.length !== 'number') {
      throw new TypeError('VFFolder.prepare expects a File array or FileList.');
    }
    return Array.prototype.slice.call(files);
  }

  function readAsText(file) {
    if (file && typeof file.text === 'function') return file.text();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(reader.error || new Error('Could not read file.')); };
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.readAsText(file);
    });
  }

  function readAsArrayBuffer(file) {
    if (file && typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(reader.error || new Error('Could not read file.')); };
      reader.onload = function () { resolve(reader.result); };
      reader.readAsArrayBuffer(file);
    });
  }

  // Chunking avoids exceeding the argument limit for large images/fonts.
  function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var chunkSize = 0x8000;
    var binary = '';
    for (var offset = 0; offset < bytes.length; offset += chunkSize) {
      var chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
      var part = '';
      for (var i = 0; i < chunk.length; i += 1) part += String.fromCharCode(chunk[i]);
      binary += part;
    }
    if (typeof btoa !== 'function') throw new Error('This browser cannot encode data URLs (btoa is unavailable).');
    return btoa(binary);
  }

  function mimeForFile(file, path) {
    if (file && file.type) return file.type;
    return MIME_BY_EXTENSION[extension(path)] || 'application/octet-stream';
  }

  function cssUnquote(value) {
    var text = String(value || '').trim();
    if (text.length >= 2 && ((text.charAt(0) === '"' && text.charAt(text.length - 1) === '"') ||
        (text.charAt(0) === "'" && text.charAt(text.length - 1) === "'"))) {
      text = text.slice(1, -1);
    }
    // This is deliberately modest: it handles common escaped quote/space paths
    // without pretending to be a complete CSS tokenizer.
    return text.replace(/\\([\\'" ])/g, '$1');
  }

  function skipCssWhitespaceAndComments(text, index) {
    var cursor = index;
    while (cursor < text.length) {
      if (/\s/.test(text.charAt(cursor))) {
        cursor += 1;
      } else if (text.slice(cursor, cursor + 2) === '/*') {
        var end = text.indexOf('*/', cursor + 2);
        cursor = end === -1 ? text.length : end + 2;
      } else {
        break;
      }
    }
    return cursor;
  }

  function readCssString(text, index) {
    var quote = text.charAt(index);
    if (quote !== '"' && quote !== "'") return null;
    var cursor = index + 1;
    var value = '';
    while (cursor < text.length) {
      var char = text.charAt(cursor);
      if (char === '\\' && cursor + 1 < text.length) {
        value += char + text.charAt(cursor + 1);
        cursor += 2;
      } else if (char === quote) {
        return { value: value, end: cursor + 1 };
      } else {
        value += char;
        cursor += 1;
      }
    }
    return null;
  }

  // Finds a matching close parenthesis while respecting CSS strings/comments.
  function findCssCloseParen(text, openIndex) {
    var depth = 1;
    var quote = '';
    for (var i = openIndex + 1; i < text.length; i += 1) {
      var char = text.charAt(i);
      if (quote) {
        if (char === '\\') i += 1;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
      } else if (text.slice(i, i + 2) === '/*') {
        var commentEnd = text.indexOf('*/', i + 2);
        if (commentEnd === -1) return -1;
        i = commentEnd + 1;
      } else if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
        if (!depth) return i;
      }
    }
    return -1;
  }

  function findCssStatementEnd(text, start) {
    var quote = '';
    var depth = 0;
    for (var i = start; i < text.length; i += 1) {
      var char = text.charAt(i);
      if (quote) {
        if (char === '\\') i += 1;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === '"' || char === "'") quote = char;
      else if (text.slice(i, i + 2) === '/*') {
        var commentEnd = text.indexOf('*/', i + 2);
        if (commentEnd === -1) return -1;
        i = commentEnd + 1;
      } else if (char === '(') depth += 1;
      else if (char === ')' && depth) depth -= 1;
      else if (char === ';' && !depth) return i;
    }
    return -1;
  }

  function parseCssImport(statement) {
    var cursor = skipCssWhitespaceAndComments(statement, 7); // after "@import"
    if (cursor >= statement.length) return null;
    var target;
    var end;
    var stringValue = readCssString(statement, cursor);
    if (stringValue) {
      target = cssUnquote(stringValue.value);
      end = stringValue.end;
    } else if (statement.slice(cursor, cursor + 3).toLowerCase() === 'url' &&
        !/[a-z0-9_-]/i.test(statement.charAt(cursor + 3))) {
      cursor = skipCssWhitespaceAndComments(statement, cursor + 3);
      if (statement.charAt(cursor) !== '(') return null;
      var close = findCssCloseParen(statement, cursor);
      if (close === -1) return null;
      target = cssUnquote(statement.slice(cursor + 1, close));
      end = close + 1;
    } else {
      return null;
    }
    // `statement` includes its terminating semicolon; it is not a qualifier.
    return { target: target, qualifiers: statement.slice(end).replace(/;\s*$/, '').trim() };
  }

  function readLeadingFunction(text, index, name) {
    var cursor = skipCssWhitespaceAndComments(text, index);
    if (text.slice(cursor, cursor + name.length).toLowerCase() !== name) return null;
    var afterName = cursor + name.length;
    if (/[a-z0-9_-]/i.test(text.charAt(afterName))) return null;
    cursor = skipCssWhitespaceAndComments(text, afterName);
    if (text.charAt(cursor) !== '(') return null;
    var close = findCssCloseParen(text, cursor);
    if (close === -1) return null;
    return { value: text.slice(cursor + 1, close).trim(), end: close + 1 };
  }

  // Preserve the meaningful common @import qualifiers after replacing the import.
  function wrapImportedCss(css, qualifiers) {
    var remaining = String(qualifiers || '').trim();
    if (!remaining) return css;
    var wrappers = [];
    var layer = readLeadingFunction(remaining, 0, 'layer');
    if (layer) {
      wrappers.push({ type: 'layer', value: layer.value });
      remaining = remaining.slice(layer.end).trim();
    } else if (/^layer\b/i.test(remaining)) {
      wrappers.push({ type: 'layer', value: '' });
      remaining = remaining.slice(5).trim();
    }
    var supports = readLeadingFunction(remaining, 0, 'supports');
    if (supports) {
      wrappers.push({ type: 'supports', value: supports.value });
      remaining = remaining.slice(supports.end).trim();
    }
    if (remaining) wrappers.push({ type: 'media', value: remaining });
    for (var i = wrappers.length - 1; i >= 0; i -= 1) {
      var wrapper = wrappers[i];
      if (wrapper.type === 'layer') css = '@layer' + (wrapper.value ? ' ' + wrapper.value : '') + ' {\n' + css + '\n}';
      else if (wrapper.type === 'supports') {
        var condition = /^(?:\(|selector\(|font-tech\(|font-format\()/i.test(wrapper.value) ? wrapper.value : '(' + wrapper.value + ')';
        css = '@supports ' + condition + ' {\n' + css + '\n}';
      }
      else css = '@media ' + wrapper.value + ' {\n' + css + '\n}';
    }
    return css;
  }

  function hasLikelyLocalSrcsetCandidate(value) {
    // We do not rewrite srcset. This small scanner is only for deciding whether
    // there is an unconverted local candidate; notably, commas inside data: URLs
    // are consumed as part of the URL rather than mistaken for a new candidate.
    var text = String(value || '');
    var cursor = 0;
    while (cursor < text.length) {
      while (cursor < text.length && (/[\s,]/.test(text.charAt(cursor)))) cursor += 1;
      if (cursor >= text.length) break;
      var start = cursor;
      var isData = text.slice(cursor, cursor + 5).toLowerCase() === 'data:';
      while (cursor < text.length && !/\s/.test(text.charAt(cursor)) && (isData || text.charAt(cursor) !== ',')) cursor += 1;
      var candidate = text.slice(start, cursor);
      if (!isRemoteOrSpecialUrl(candidate)) return true;
      // Skip descriptors (for example "2x" or "480w") up to the separator.
      while (cursor < text.length && text.charAt(cursor) !== ',') cursor += 1;
      if (text.charAt(cursor) === ',') cursor += 1;
    }
    return false;
  }

  function cssReferences(text) {
    var refs = [];
    for (var cursor = 0; cursor < text.length;) {
      if (text.slice(cursor, cursor + 2) === '/*') {
        var end = text.indexOf('*/', cursor + 2); cursor = end < 0 ? text.length : end + 2; continue;
      }
      if (text.charAt(cursor) === '"' || text.charAt(cursor) === "'") {
        var string = readCssString(text, cursor); cursor = string ? string.end : text.length; continue;
      }
      if (text.slice(cursor, cursor + 7).toLowerCase() === '@import' && !/[a-z0-9_-]/i.test(text.charAt(cursor + 7))) {
        var statementEnd = findCssStatementEnd(text, cursor + 7);
        if (statementEnd >= 0) {
          var imported = parseCssImport(text.slice(cursor, statementEnd + 1));
          if (imported) refs.push({url:imported.target, kind:'CSS @import'});
          cursor = statementEnd + 1; continue;
        }
      }
      if (text.slice(cursor, cursor + 3).toLowerCase() === 'url' && !/[a-z0-9_-]/i.test(text.charAt(cursor - 1)) && !/[a-z0-9_-]/i.test(text.charAt(cursor + 3))) {
        var open = skipCssWhitespaceAndComments(text, cursor + 3);
        if (text.charAt(open) === '(') {
          var close = findCssCloseParen(text, open);
          if (close >= 0) { refs.push({url:cssUnquote(text.slice(open + 1, close)),kind:'CSS url()'}); cursor = close + 1; continue; }
        }
      }
      cursor += 1;
    }
    return refs;
  }

  function srcsetCandidates(text) {
    var urls = [], cursor = 0;
    while (cursor < text.length) {
      while (cursor < text.length && /[\s,]/.test(text.charAt(cursor))) cursor += 1;
      var start = cursor, data = text.slice(cursor, cursor + 5).toLowerCase() === 'data:';
      while (cursor < text.length && !/\s/.test(text.charAt(cursor)) && (data || text.charAt(cursor) !== ',')) cursor += 1;
      if (cursor > start) urls.push(text.slice(start, cursor));
      while (cursor < text.length && text.charAt(cursor) !== ',') cursor += 1;
      if (text.charAt(cursor) === ',') cursor += 1;
    }
    return urls;
  }

  // Inspect only the prepared DOM. Inlined nested CSS is already present here;
  // remote stylesheets/scripts are listed, never fetched or recursively crawled.
  function describe(html, entryPath) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var externalResources = [], seen = new Set(), base = doc.querySelector('base[href]')?.getAttribute('href') || '';
    var remoteBase = /^(?:https?:)?\/\//i.test(base) ? new URL(base, 'https://visionflow.invalid/').href : '';
    function add(raw, kind, reference, baseOverride) {
      raw = String(raw || '').trim();
      if (!raw || raw.charAt(0) === '#' || /^(?:data|blob|javascript|vbscript|mailto|tel):/i.test(raw)) return;
      var resolveBase = baseOverride === undefined ? remoteBase : baseOverride;
      if (!/^(?:https?:)?\/\//i.test(raw) && (!resolveBase || /^[a-z][a-z0-9+.-]*:/i.test(raw))) return;
      var url; try { url = new URL(raw, resolveBase || 'https://visionflow.invalid/').href; } catch (_) { return; }
      if (!/^https?:/i.test(url)) return;
      var key = JSON.stringify([url, kind, reference]);
      if (!seen.has(key) && externalResources.length < 2000) {
        seen.add(key); externalResources.push({url:url,kind:kind,reference:reference});
      }
    }
    var reference = entryPath || 'index.html';
    if (remoteBase) add(base,'external base',reference,'');
    doc.querySelectorAll('link[href]').forEach(function (el) {
      var rel = el.getAttribute('rel') || '';
      if (/(?:^|\s)(?:stylesheet|icon|apple-touch-icon|preload|modulepreload)(?:\s|$)/i.test(rel)) add(el.getAttribute('href'),'link '+rel,reference);
    });
    doc.querySelectorAll('[src],[poster]').forEach(function (el) {
      ['src','poster'].forEach(function (attr) { if (el.hasAttribute(attr)) add(el.getAttribute(attr),el.tagName.toLowerCase()+' '+attr,reference); });
    });
    doc.querySelectorAll('svg image,svg use').forEach(function (el) { add(el.getAttribute('href') || el.getAttribute('xlink:href'),'SVG href',reference); });
    doc.querySelectorAll('[srcset]').forEach(function (el) { srcsetCandidates(el.getAttribute('srcset')).forEach(function (url) { add(url,el.tagName.toLowerCase()+' srcset',reference); }); });
    doc.querySelectorAll('style,[style]').forEach(function (el) {
      var origin = el.getAttribute('data-vf-inlined-stylesheet') || reference + (el.tagName === 'STYLE' ? ' inline <style>' : ' style attribute');
      cssReferences(el.tagName === 'STYLE' ? el.textContent : el.getAttribute('style')).forEach(function (item) { add(item.url,item.kind,origin); });
    });
    return {externalResources:externalResources};
  }

  function serializeDocument(document) {
    var prefix = '<!doctype html>';
    if (document.doctype) {
      prefix = '<!DOCTYPE ' + document.doctype.name +
        (document.doctype.publicId ? ' PUBLIC "' + document.doctype.publicId + '"' : '') +
        (document.doctype.systemId ? ' "' + document.doctype.systemId + '"' : '') + '>';
    }
    return prefix + '\n' + document.documentElement.outerHTML;
  }

  function prepare(files, requestedEntryPath) {
    return Promise.resolve().then(async function () {
      var sourceFiles = toArray(files);
      var warnings = [];
      var warningSet = new Set();
      function warn(message) {
        if (!warningSet.has(message)) {
          warningSet.add(message);
          warnings.push(message);
        }
      }

      if (!sourceFiles.length) throw new Error('VFFolder.prepare received no files.');

      // `webkitRelativePath` normally starts with the picked directory name.
      // Strip exactly one common top-level segment so "root index.html" means
      // index.html, rather than "chosen-folder/index.html".
      var rawRecords = sourceFiles.map(function (file, index) {
        var raw = normalizePath((file && file.webkitRelativePath) || (file && file.name) || ('unnamed-' + index));
        return { file: file, raw: raw };
      }).filter(function (record) { return record.raw; });
      if (!rawRecords.length) throw new Error('The supplied files have no usable names.');

      var firstSegments = new Set();
      var hasRootFile = false;
      rawRecords.forEach(function (record) {
        var slash = record.raw.indexOf('/');
        if (slash === -1) hasRootFile = true;
        else firstSegments.add(record.raw.slice(0, slash));
      });
      var commonTopLevel = !hasRootFile && firstSegments.size === 1 ? Array.from(firstSegments)[0] : '';

      var fileByPath = new Map();
      var rawToPath = new Map();
      rawRecords.forEach(function (record) {
        var path = record.raw;
        if (commonTopLevel && path.indexOf(commonTopLevel + '/') === 0) path = path.slice(commonTopLevel.length + 1);
        path = normalizePath(path);
        rawToPath.set(record.raw, path);
        if (fileByPath.has(path)) {
          warn('Duplicate folder path "' + path + '"; the first file will be used.');
        } else {
          fileByPath.set(path, record.file);
        }
      });

      var htmlPaths = Array.from(fileByPath.keys()).filter(isHtmlPath).sort(function (a, b) {
        return a.localeCompare(b, undefined, { sensitivity: 'base' });
      });
      if (!htmlPaths.length) throw new Error('No .html or .htm file was found in the selected folder.');

      function entryCandidate(value) {
        if (value === undefined || value === null || value === '') return '';
        var clean = normalizePath(splitUrl(value).pathname);
        if (fileByPath.has(clean)) return clean;
        if (rawToPath.has(clean)) return rawToPath.get(clean);
        if (commonTopLevel && clean.indexOf(commonTopLevel + '/') === 0) {
          clean = clean.slice(commonTopLevel.length + 1);
          if (fileByPath.has(clean)) return clean;
        }
        return '';
      }

      var requested = entryCandidate(requestedEntryPath);
      var entryPath = requested || (fileByPath.has('index.html') ? 'index.html' : htmlPaths[0]);
      if (requestedEntryPath && !requested) {
        warn('Requested entry page "' + requestedEntryPath + '" was not found; using "' + entryPath + '".');
      }
      if (!isHtmlPath(entryPath)) {
        warn('Requested entry path is not an HTML page; using the default HTML page instead.');
        entryPath = fileByPath.has('index.html') ? 'index.html' : htmlPaths[0];
      }

      var dataUrlCache = new Map();
      var textCache = new Map();
      var cssCache = new Map();

      function getText(path) {
        if (!textCache.has(path)) textCache.set(path, readAsText(fileByPath.get(path)));
        return textCache.get(path);
      }

      function dataUrlFor(path) {
        if (!dataUrlCache.has(path)) {
          var file = fileByPath.get(path);
          dataUrlCache.set(path, readAsArrayBuffer(file).then(function (buffer) {
            return 'data:' + mimeForFile(file, path) + ';base64,' + arrayBufferToBase64(buffer);
          }));
        }
        return dataUrlCache.get(path);
      }

      function classifyLocalUrl(rawUrl, baseDirectory) {
        var raw = String(rawUrl || '').trim();
        if (isRemoteOrSpecialUrl(raw)) return { local: false };
        var pieces = splitUrl(raw);
        if (!pieces.pathname) return { local: false };
        return {
          local: true,
          path: resolveVirtualPath(baseDirectory, pieces.pathname),
          fragment: pieces.fragment
        };
      }

      async function inlineLocalUrl(rawUrl, baseDirectory, reference) {
        var resolved = classifyLocalUrl(rawUrl, baseDirectory);
        if (!resolved.local) return null;
        if (!fileByPath.has(resolved.path)) {
          warn('Missing local resource "' + rawUrl + '" (resolved as "' + resolved.path + '") in ' + reference + '.');
          return null;
        }
        return (await dataUrlFor(resolved.path)) + resolved.fragment;
      }

      async function rewriteCssUrls(css, baseDirectory, reference) {
        var output = '';
        var cursor = 0;
        var quote = '';
        while (cursor < css.length) {
          var char = css.charAt(cursor);
          if (quote) {
            output += char;
            if (char === '\\' && cursor + 1 < css.length) {
              output += css.charAt(cursor + 1);
              cursor += 2;
              continue;
            }
            if (char === quote) quote = '';
            cursor += 1;
            continue;
          }
          if (char === '"' || char === "'") {
            quote = char;
            output += char;
            cursor += 1;
            continue;
          }
          if (css.slice(cursor, cursor + 2) === '/*') {
            var commentEnd = css.indexOf('*/', cursor + 2);
            if (commentEnd === -1) return output + css.slice(cursor);
            output += css.slice(cursor, commentEnd + 2);
            cursor = commentEnd + 2;
            continue;
          }
          if (css.slice(cursor, cursor + 3).toLowerCase() === 'url' &&
              !/[a-z0-9_-]/i.test(css.charAt(cursor - 1)) && !/[a-z0-9_-]/i.test(css.charAt(cursor + 3))) {
            var afterUrl = skipCssWhitespaceAndComments(css, cursor + 3);
            if (css.charAt(afterUrl) === '(') {
              var close = findCssCloseParen(css, afterUrl);
              if (close !== -1) {
                var rawValue = cssUnquote(css.slice(afterUrl + 1, close));
                var inlined = await inlineLocalUrl(rawValue, baseDirectory, reference + ' CSS url()');
                if (inlined) {
                  // Always quote emitted data URLs. Base64 itself contains no quote,
                  // whitespace, or parenthesis and remains valid in CSS.
                  output += 'url("' + inlined.replace(/"/g, '%22') + '")';
                  cursor = close + 1;
                  continue;
                }
              }
            }
          }
          output += char;
          cursor += 1;
        }
        return output;
      }

      async function rewriteCss(css, baseDirectory, sourcePath, ancestry) {
        // First inline @import rules. Scanning ignores strings/comments and only
        // treats real @import tokens as candidates.
        var output = '';
        var cursor = 0;
        var quote = '';
        while (cursor < css.length) {
          var char = css.charAt(cursor);
          if (quote) {
            output += char;
            if (char === '\\' && cursor + 1 < css.length) {
              output += css.charAt(cursor + 1);
              cursor += 2;
              continue;
            }
            if (char === quote) quote = '';
            cursor += 1;
            continue;
          }
          if (char === '"' || char === "'") {
            quote = char;
            output += char;
            cursor += 1;
            continue;
          }
          if (css.slice(cursor, cursor + 2) === '/*') {
            var commentEnd = css.indexOf('*/', cursor + 2);
            if (commentEnd === -1) {
              output += css.slice(cursor);
              break;
            }
            output += css.slice(cursor, commentEnd + 2);
            cursor = commentEnd + 2;
            continue;
          }
          if (css.slice(cursor, cursor + 7).toLowerCase() === '@import' &&
              !/[a-z0-9_-]/i.test(css.charAt(cursor - 1)) && !/[a-z0-9_-]/i.test(css.charAt(cursor + 7))) {
            var statementEnd = findCssStatementEnd(css, cursor + 7);
            if (statementEnd !== -1) {
              var statement = css.slice(cursor, statementEnd + 1);
              var imported = parseCssImport(statement);
              if (imported) {
                var target = classifyLocalUrl(imported.target, baseDirectory);
                if (target.local) {
                  if (!fileByPath.has(target.path)) {
                    warn('Missing local CSS import "' + imported.target + '" (resolved as "' + target.path + '") in "' + sourcePath + '".');
                    output += statement;
                  } else if (ancestry.has(target.path)) {
                    warn('CSS @import cycle detected: ' + Array.from(ancestry).concat([target.path]).join(' -> ') + '. The cyclic import was omitted.');
                    output += '/* VisionFlow omitted cyclic @import: ' + imported.target.replace(/\*\//g, '') + ' */';
                  } else {
                    var childCss = await transformCssFile(target.path, ancestry);
                    output += '/* VisionFlow inlined @import: ' + target.path + ' */\n' + wrapImportedCss(childCss, imported.qualifiers);
                  }
                  cursor = statementEnd + 1;
                  continue;
                }
              }
            }
          }
          output += char;
          cursor += 1;
        }
        return rewriteCssUrls(output, baseDirectory, '"' + sourcePath + '"');
      }

      function transformCssFile(path, ancestry) {
        // Check ancestry before cache: a cached in-flight promise can otherwise
        // reintroduce a circular wait for A.css -> B.css -> A.css.
        if (ancestry.has(path)) {
          warn('CSS @import cycle detected at "' + path + '". The cyclic import was omitted.');
          return Promise.resolve('');
        }
        if (cssCache.has(path)) return cssCache.get(path);
        var nextAncestry = new Set(ancestry);
        nextAncestry.add(path);
        var promise = getText(path).then(function (cssText) {
          return rewriteCss(cssText, dirname(path), path, nextAncestry);
        });
        cssCache.set(path, promise);
        return promise;
      }

      var entryText = await getText(entryPath);
      if (typeof DOMParser === 'undefined') {
        throw new Error('VFFolder.prepare requires DOMParser in a browser environment.');
      }
      var document = new DOMParser().parseFromString(entryText, 'text/html');
      var documentDirectory = dirname(entryPath);
      var baseDirectory = documentDirectory;
      var hasExternalBase = false;
      var baseElement = document.querySelector('base[href]');
      if (baseElement) {
        var baseHref = (baseElement.getAttribute('href') || '').trim();
        if (baseHref && baseHref.charAt(0) !== '#' && !isRemoteOrSpecialUrl(baseHref)) {
          var basePieces = splitUrl(baseHref);
          var resolvedBase = resolveVirtualPath(documentDirectory, basePieces.pathname);
          // A trailing slash denotes a directory; otherwise a base URL names a
          // file-like endpoint and relative links resolve beside it.
          baseDirectory = /\/$/.test(basePieces.pathname) ? resolvedBase : dirname(resolvedBase);
        } else if (baseHref && isRemoteOrSpecialUrl(baseHref) && baseHref.charAt(0) !== '#') {
          // Preserve external bases unchanged. Relative URLs under them are remote,
          // so attempting to find them in the picked folder would be incorrect.
          hasExternalBase = true;
        }
      }

      async function inlineHtmlAttribute(element, attribute, reference) {
        if (hasExternalBase) return;
        var original = element.getAttribute(attribute);
        if (original === null || original === '') return;
        var inlined = await inlineLocalUrl(original, baseDirectory, reference + ' in "' + entryPath + '"');
        if (inlined) element.setAttribute(attribute, inlined);
      }

      // A linked stylesheet becomes a real <style>, retaining useful media/title
      // metadata. CSS imports and nested resource URLs are handled recursively.
      var stylesheetLinks = Array.prototype.slice.call(document.querySelectorAll('link[href]')).filter(function (link) {
        return (link.getAttribute('rel') || '').toLowerCase().split(/\s+/).indexOf('stylesheet') !== -1;
      });
      for (var linkIndex = 0; linkIndex < stylesheetLinks.length; linkIndex += 1) {
        var link = stylesheetLinks[linkIndex];
        if (hasExternalBase) continue;
        var href = link.getAttribute('href') || '';
        var cssTarget = classifyLocalUrl(href, baseDirectory);
        if (!cssTarget.local) continue;
        if (!fileByPath.has(cssTarget.path)) {
          warn('Missing local stylesheet "' + href + '" (resolved as "' + cssTarget.path + '") in "' + entryPath + '".');
          continue;
        }
        var style = document.createElement('style');
        ['media', 'title', 'nonce'].forEach(function (attribute) {
          if (link.hasAttribute(attribute)) style.setAttribute(attribute, link.getAttribute(attribute));
        });
        style.setAttribute('data-vf-inlined-stylesheet', cssTarget.path);
        style.textContent = await transformCssFile(cssTarget.path, new Set());
        link.parentNode.replaceChild(style, link);
      }

      // Existing <style> blocks can also contain @import and url(...).
      var inlineStyles = document.querySelectorAll('style:not([data-vf-inlined-stylesheet])');
      for (var styleIndex = 0; styleIndex < inlineStyles.length; styleIndex += 1) {
        if (!hasExternalBase) {
          inlineStyles[styleIndex].textContent = await rewriteCss(
            inlineStyles[styleIndex].textContent || '', baseDirectory, entryPath + ' inline <style>', new Set()
          );
        }
      }

      // Inline CSS url() values in style attributes as well. @import is invalid in
      // style attributes and is intentionally not processed here.
      if (!hasExternalBase) {
        var styledElements = document.querySelectorAll('[style]');
        for (var styledIndex = 0; styledIndex < styledElements.length; styledIndex += 1) {
          var styledElement = styledElements[styledIndex];
          styledElement.setAttribute('style', await rewriteCssUrls(
            styledElement.getAttribute('style') || '', baseDirectory, 'style attribute in "' + entryPath + '"'
          ));
        }
      }

      // Local visual/media resources. Anchor href values are intentionally absent:
      // page navigation is a UI concern, not a resource to fetch or inline.
      var srcSelectors = [
        'img[src]', 'source[src]', 'video[src]', 'audio[src]', 'track[src]',
        'input[type="image"][src]', 'image[src]'
      ].join(',');
      var srcElements = document.querySelectorAll(srcSelectors);
      for (var srcIndex = 0; srcIndex < srcElements.length; srcIndex += 1) {
        await inlineHtmlAttribute(srcElements[srcIndex], 'src', '<' + srcElements[srcIndex].tagName.toLowerCase() + ' src>');
      }
      var posterElements = document.querySelectorAll('[poster]');
      for (var posterIndex = 0; posterIndex < posterElements.length; posterIndex += 1) {
        await inlineHtmlAttribute(posterElements[posterIndex], 'poster', '<' + posterElements[posterIndex].tagName.toLowerCase() + ' poster>');
      }
      var iconLinks = Array.prototype.slice.call(document.querySelectorAll('link[href]')).filter(function (link) {
        var rel = (link.getAttribute('rel') || '').toLowerCase();
        return /(?:^|\s)(?:icon|apple-touch-icon)(?:\s|$)/.test(rel);
      });
      for (var iconIndex = 0; iconIndex < iconLinks.length; iconIndex += 1) {
        await inlineHtmlAttribute(iconLinks[iconIndex], 'href', '<link rel="icon" href>');
      }

      // Keep srcset source text rather than emitting fragile data URLs. A standard
      // srcset parser is possible, but a naive comma split corrupts data: URLs.
      var srcsetElements = document.querySelectorAll('[srcset]');
      for (var srcsetIndex = 0; srcsetIndex < srcsetElements.length; srcsetIndex += 1) {
        var srcsetElement = srcsetElements[srcsetIndex];
        if (!hasExternalBase && hasLikelyLocalSrcsetCandidate(srcsetElement.getAttribute('srcset'))) {
          warn('Local srcset was left unchanged on <' + srcsetElement.tagName.toLowerCase() + '> in "' + entryPath + '" because data URL commas make unsafe parsing unreliable.');
        }
      }

      // Convert local external scripts to data URLs without evaluating them, then
      // make every script tag inert. This also protects against inline scripts.
      var scripts = document.querySelectorAll('script');
      var disabledScriptCount = 0;
      for (var scriptIndex = 0; scriptIndex < scripts.length; scriptIndex += 1) {
        var script = scripts[scriptIndex];
        if (script.hasAttribute('src')) await inlineHtmlAttribute(script, 'src', '<script src>');
        var originalType = script.getAttribute('type');
        if ((originalType || '').toLowerCase() !== DATA_DISABLED_SCRIPT_TYPE) {
          script.setAttribute('data-vf-original-type', originalType === null ? 'text/javascript' : originalType);
          script.setAttribute('type', DATA_DISABLED_SCRIPT_TYPE);
          disabledScriptCount += 1;
        }
      }
      if (disabledScriptCount) {
        warn('Disabled ' + disabledScriptCount + ' script tag(s) in the returned HTML; VFFolder.prepare never executes imported JavaScript.');
      }

      return {
        html: serializeDocument(document),
        pages: htmlPaths.map(function (path) { return { path: path, name: basename(path) }; }),
        entryPath: entryPath,
        warnings: warnings,
        externalResources: describe(serializeDocument(document), entryPath).externalResources
      };
    });
  }

  global.VFFolder = global.VFFolder || {};
  global.VFFolder.prepare = prepare;
  global.VFFolder.describe = describe;
})(typeof window !== 'undefined' ? window : globalThis);
