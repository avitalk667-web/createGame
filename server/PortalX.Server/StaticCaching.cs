using System.Reflection;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.StaticFiles;

namespace PortalX.Server;

/// <summary>
/// Cache rules for the Angular site. index.html (and the SPA fallback) must always be revalidated, otherwise
/// a browser or filtering proxy keeps showing an old version after a deploy. Bundles with a content hash in
/// their name never change, so they may be cached for a year. Everything else is revalidated by a content ETag
/// (see <see cref="StaticAssets"/>), so a deploy does not make browsers download unchanged files again.
/// </summary>
public static partial class StaticCaching
{
    /// <summary>Angular's output: bundles and the fonts it copies to media/, with a content hash in the name.</summary>
    [GeneratedRegex(@"-[A-Z0-9]{8}\.(js|css|woff2?|ttf|otf|eot)$")]
    private static partial Regex HashedBundle();

    public static void Apply(StaticFileResponseContext ctx)
    {
        var headers = ctx.Context.Response.Headers;
        var name = StaticAssets.OriginalName(ctx.Context, ctx.File.Name);
        headers.CacheControl = CacheControlFor(ctx.Context, name);
        if (name.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
        {
            headers.Pragma = "no-cache";
            headers.Expires = "0";
        }
        StaticAssets.ApplyHeaders(ctx.Context);
    }

    /// <summary>The Cache-Control of a site file (also sent with a 304 answer, to renew the browser's copy).</summary>
    public static string CacheControlFor(HttpContext ctx, string name)
    {
        if (name.EndsWith(".html", StringComparison.OrdinalIgnoreCase)) return "no-cache, no-store, must-revalidate";
        if (HashedBundle().IsMatch(name) || IsVersioned(ctx, name)) return "public, max-age=31536000, immutable";
        // videos and pictures keep their name when replaced: a day, then a cheap revalidation by content ETag;
        // during the following week an expired copy may be shown at once while it is revalidated in the background
        if (DayLong.Contains(Path.GetExtension(name))) return "public, max-age=86400, stale-while-revalidate=604800";
        return "public, max-age=3600";
    }

    /// <summary>
    /// A 3D model or picture asked for with its version (library.glb?v=…, favicon.ico?v=2): a new version is a new
    /// address. (Not the manifest or other text files, which may change without a new version.)
    /// </summary>
    private static bool IsVersioned(HttpContext ctx, string name) =>
        (name.EndsWith(".glb", StringComparison.OrdinalIgnoreCase) || Pictures.Contains(Path.GetExtension(name)))
        && !string.IsNullOrWhiteSpace(ctx.Request.Query["v"].ToString());

    private static readonly HashSet<string> Pictures = new(StringComparer.OrdinalIgnoreCase)
    {
        ".webp", ".avif", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
    };

    private static readonly HashSet<string> DayLong = new(Pictures.Concat([".mp4", ".webm"]), StringComparer.OrdinalIgnoreCase);

    /// <summary>The usual web types, plus 3D models (.glb), which ASP.NET does not serve by default.</summary>
    private static readonly FileExtensionContentTypeProvider Types = CreateTypes();

    private static FileExtensionContentTypeProvider CreateTypes()
    {
        var t = new FileExtensionContentTypeProvider();
        t.Mappings[".glb"] = "model/gltf-binary";
        // the build's Brotli copies of the models (library.glb.br); sent as model/gltf-binary + Content-Encoding: br
        t.Mappings[".br"] = "application/octet-stream";
        return t;
    }

    public static StaticFileOptions Options => new() { OnPrepareResponse = Apply, ContentTypeProvider = Types };

    /// <summary>What is deployed: the git commit (Render sets RENDER_GIT_COMMIT), the front-end bundle and when it was built.</summary>
    public static object Version(IWebHostEnvironment env)
    {
        var index = env.WebRootFileProvider.GetFileInfo("index.html");
        string? bundle = null;
        if (index.Exists)
        {
            using var reader = new StreamReader(index.CreateReadStream());
            bundle = Regex.Match(reader.ReadToEnd(), @"main-[A-Z0-9]+\.js").Value;
        }
        return new
        {
            commit = Environment.GetEnvironmentVariable("RENDER_GIT_COMMIT")
                ?? Environment.GetEnvironmentVariable("GIT_COMMIT") ?? "unknown",
            branch = Environment.GetEnvironmentVariable("RENDER_GIT_BRANCH"),
            frontendBundle = string.IsNullOrEmpty(bundle) ? null : bundle,
            frontendBuiltAt = index.Exists ? index.LastModified.UtcDateTime : (DateTime?)null,
            serverBuild = Assembly.GetExecutingAssembly().GetName().Version?.ToString(),
            environment = env.EnvironmentName,
        };
    }
}
