using System.Collections.Concurrent;
using System.IO.Compression;
using System.Security.Cryptography;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;

namespace PortalX.Server;

/// <summary>
/// Runs right before the static file middleware, for files of the built site (wwwroot), and saves bandwidth twice:
/// <list type="bullet">
/// <item>ETags from the file's content, not its date. Every deploy rebuilds every file with a new date, so date-based
/// ETags made returning browsers download all pictures, fonts and the video again; now an unchanged file answers
/// 304 Not Modified (a few hundred bytes) after a deploy too.</item>
/// <item>3D models: a browser that accepts Brotli gets the build's lossless .glb.br copy (about half the size) with
/// Content-Encoding: br and the model's own Content-Type; the browser unpacks it to the very same bytes, so Three.js
/// sees no difference. Others, and range requests, get the original. A copy is used only after the server checked
/// once that it unpacks to exactly the current model.</item>
/// </list>
/// index.html is left alone (never cached, see <see cref="StaticCaching"/>).
/// </summary>
public static class StaticAssets
{
    private const string EtagKey = "px-static-etag";
    private const string EncodingKey = "px-static-encoding";

    public static IApplicationBuilder UseStaticAssetValidation(this IApplicationBuilder app)
    {
        var env = app.ApplicationServices.GetRequiredService<IWebHostEnvironment>();
        var files = env.WebRootFileProvider;
        // hash everything once in the background, so the first visitors do not wait for it
        _ = Task.Run(() => WarmUp(files, ""));
        return app.Use(async (ctx, next) =>
        {
            if (!TryPrepare(ctx, files, out var etag)) { await next(); return; }
            var req = ctx.Request;
            if (IfNoneMatch(req, etag))
            {
                var res = ctx.Response;
                res.StatusCode = StatusCodes.Status304NotModified;
                res.Headers.ETag = etag;
                res.Headers.CacheControl = StaticCaching.CacheControlFor(ctx, OriginalName(ctx));
                if (IsModel(req.Path)) res.Headers.Vary = HeaderNames.AcceptEncoding;
                return;
            }
            // a resumed download ("send the rest if it is still the same file"): answer by content, not by date
            if (req.Headers.TryGetValue(HeaderNames.IfRange, out var ifRange))
            {
                if (ifRange.ToString().Trim() == etag) req.Headers.Remove(HeaderNames.IfRange);
                else req.Headers.Remove(HeaderNames.Range); // changed: the whole new file
            }
            // our ETag is not the static file middleware's own (date-based) one, so it never answers 304 by it
            await next();
        });
    }

    /// <summary>Called from the static file middleware's OnPrepareResponse: our ETag and the Brotli headers.</summary>
    internal static void ApplyHeaders(HttpContext ctx)
    {
        var headers = ctx.Response.Headers;
        if (ctx.Items[EtagKey] is string etag)
        {
            headers.ETag = etag;
            // only the content ETag is used to ask "changed?" (the date changes with every deploy)
            headers.Remove(HeaderNames.LastModified);
        }
        // a model's bytes depend on Accept-Encoding: caches must keep the two versions apart
        if (IsModel(ctx.Request.Path)) headers.Vary = HeaderNames.AcceptEncoding;
        if (ctx.Items[EncodingKey] is string encoding)
        {
            headers.ContentEncoding = encoding;
            headers.ContentType = "model/gltf-binary";
        }
    }

    /// <summary>The name of the file the visitor asked for (library.glb even when library.glb.br is sent).</summary>
    internal static string OriginalName(HttpContext ctx, string? servedName = null)
    {
        var name = servedName ?? Path.GetFileName(ctx.Request.Path.Value ?? "");
        return ctx.Items[EncodingKey] is "br" && name.EndsWith(".br", StringComparison.OrdinalIgnoreCase) ? name[..^3] : name;
    }

    private static bool TryPrepare(HttpContext ctx, IFileProvider files, out string etag)
    {
        etag = "";
        var req = ctx.Request;
        if (!HttpMethods.IsGet(req.Method) && !HttpMethods.IsHead(req.Method)) return false;
        var path = req.Path.Value;
        if (string.IsNullOrEmpty(path) || !Path.HasExtension(path) || path.EndsWith(".html", StringComparison.OrdinalIgnoreCase)
            || req.Path.StartsWithSegments("/api") || req.Path.StartsWithSegments("/hubs")) return false;
        var file = files.GetFileInfo(path);
        if (!file.Exists || file.IsDirectory || file.PhysicalPath is null) return false;

        if (IsModel(req.Path) && AcceptsBrotli(req) && !req.Headers.ContainsKey(HeaderNames.Range))
        {
            var br = files.GetFileInfo(path + ".br");
            if (br.Exists && br.PhysicalPath is not null && BrotliCopyMatches(file, br))
            {
                req.Path = path + ".br";
                ctx.Items[EncodingKey] = "br";
                file = br;
            }
        }
        etag = ContentEtag(file);
        ctx.Items[EtagKey] = etag;
        return true;
    }

    private static bool IsModel(PathString path) =>
        path.Value is { } p && (p.EndsWith(".glb", StringComparison.OrdinalIgnoreCase) || p.EndsWith(".glb.br", StringComparison.OrdinalIgnoreCase));

    private static bool AcceptsBrotli(HttpRequest req)
    {
        foreach (var value in req.Headers.AcceptEncoding)
            foreach (var part in (value ?? "").Split(','))
            {
                var bits = part.Split(';');
                if (!bits[0].Trim().Equals("br", StringComparison.OrdinalIgnoreCase)) continue;
                // "br;q=0" means "not br"
                return !(bits.Length > 1 && bits[1].Trim().Replace(" ", "") is "q=0" or "q=0.0" or "q=0.00" or "q=0.000");
            }
        return false;
    }

    private static bool IfNoneMatch(HttpRequest req, string etag)
    {
        foreach (var value in req.Headers.IfNoneMatch)
            foreach (var tag in (value ?? "").Split(','))
            {
                var t = tag.Trim();
                if (t.StartsWith("W/", StringComparison.Ordinal)) t = t[2..];
                if (t == etag || t == "*") return true;
            }
        return false;
    }

    // ------------------------------------------------------------------ content hashes (computed once per file version)

    private sealed record Entry(long Length, DateTimeOffset Modified, string Hash);
    private static readonly ConcurrentDictionary<string, Entry> Hashes = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, bool> BrotliChecks = new(StringComparer.Ordinal);

    /// <summary>A strong ETag from the file's SHA-256 (the first 128 bits).</summary>
    internal static string ContentEtag(IFileInfo file) => $"\"{HashOf(file)[..32]}\"";

    private static string HashOf(IFileInfo file)
    {
        var key = file.PhysicalPath!;
        if (Hashes.TryGetValue(key, out var e) && e.Length == file.Length && e.Modified == file.LastModified) return e.Hash;
        using var stream = file.CreateReadStream();
        var hash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        Hashes[key] = new Entry(file.Length, file.LastModified, hash);
        return hash;
    }

    /// <summary>True when the .br copy unpacks to exactly the current model (a stale copy is never sent).</summary>
    private static bool BrotliCopyMatches(IFileInfo original, IFileInfo br)
    {
        var key = $"{HashOf(original)}|{HashOf(br)}";
        return BrotliChecks.GetOrAdd(key, _ =>
        {
            try
            {
                using var input = br.CreateReadStream();
                using var unpack = new BrotliStream(input, CompressionMode.Decompress);
                return Convert.ToHexString(SHA256.HashData(unpack)).ToLowerInvariant() == HashOf(original);
            }
            // not valid Brotli (.NET reports it as InvalidOperationException) or unreadable: send the original
            catch (Exception e) when (e is InvalidDataException or InvalidOperationException or IOException) { return false; }
        });
    }

    private static void WarmUp(IFileProvider files, string dir)
    {
        try
        {
            foreach (var f in files.GetDirectoryContents(dir))
            {
                var path = dir + "/" + f.Name;
                if (f.IsDirectory) { WarmUp(files, path); continue; }
                if (f.PhysicalPath is null || f.Name.EndsWith(".html", StringComparison.OrdinalIgnoreCase)) continue;
                HashOf(f);
                if (f.Name.EndsWith(".glb.br", StringComparison.OrdinalIgnoreCase))
                {
                    var original = files.GetFileInfo(path[..^3]);
                    if (original.Exists) BrotliCopyMatches(original, f);
                }
            }
        }
        catch (Exception) { /* best effort: anything missed is hashed on its first request */ }
    }
}
