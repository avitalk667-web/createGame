using System.Reflection;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.StaticFiles;

namespace PortalX.Server;

/// <summary>
/// Cache rules for the Angular site. index.html (and the SPA fallback) must always be revalidated, otherwise
/// a browser or filtering proxy keeps showing an old version after a deploy. Bundles with a content hash in
/// their name never change, so they may be cached for a year.
/// </summary>
public static partial class StaticCaching
{
    [GeneratedRegex(@"-[A-Z0-9]{8}\.(js|css)$")]
    private static partial Regex HashedBundle();

    public static void Apply(StaticFileResponseContext ctx)
    {
        var name = ctx.File.Name;
        var headers = ctx.Context.Response.Headers;
        if (name.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
        {
            headers.CacheControl = "no-cache, no-store, must-revalidate";
            headers.Pragma = "no-cache";
            headers.Expires = "0";
        }
        else if (HashedBundle().IsMatch(name))
            headers.CacheControl = "public, max-age=31536000, immutable";
        else
            headers.CacheControl = "public, max-age=3600";
    }

    public static StaticFileOptions Options => new() { OnPrepareResponse = Apply };

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
