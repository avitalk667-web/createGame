using System.Net.Http.Json;
using System.Text.Json;

namespace PortalX.Tests;

/// <summary>After a deploy every browser must get the new site: index.html is never cached, hashed bundles are.</summary>
[Collection(DatabaseCollection.Name)]
public class StaticCachingTests(HubIntegrationTests.Factory factory)
{
    [Theory]
    [InlineData("/")]
    [InlineData("/index.html")]
    [InlineData("/games/hanukkah-oil")]
    public async Task Pages_are_never_served_from_a_stale_cache(string url)
    {
        var res = await factory.CreateClient().GetAsync(url);
        res.EnsureSuccessStatusCode();
        Assert.Equal("text/html", res.Content.Headers.ContentType?.MediaType);
        var cc = res.Headers.CacheControl!;
        Assert.True(cc.NoCache && cc.NoStore && cc.MustRevalidate, cc.ToString());
    }

    [Fact]
    public async Task Hashed_bundles_are_cached_and_version_reports_the_bundle()
    {
        var http = factory.CreateClient();
        var version = await http.GetFromJsonAsync<JsonElement>("/api/version");
        var bundle = version.GetProperty("frontendBundle").GetString();
        Assert.Matches(@"^main-[A-Z0-9]+\.js$", bundle);
        Assert.True(version.TryGetProperty("commit", out _));

        var html = await http.GetStringAsync("/");
        Assert.Contains(bundle!, html);
        var js = await http.GetAsync("/" + bundle);
        js.EnsureSuccessStatusCode();
        Assert.Equal(TimeSpan.FromDays(365), js.Headers.CacheControl!.MaxAge);
    }

    [Theory]
    // a versioned 3D model: a new version is a new address, so a year
    [InlineData("/models/library/library.glb?v=3", 365 * 86400, true)]
    // the same model without a version keeps the short rule
    [InlineData("/models/library/library.glb", 3600, false)]
    // videos and pictures keep their names when replaced: a day, then revalidated
    [InlineData("/video/gameplay-showcase.mp4", 86400, false)]
    [InlineData("/video/gameplay-showcase-poster.webp", 86400, false)]
    [InlineData("/apple-touch-icon.png", 86400, false)]
    // anything else that keeps its name stays at an hour
    [InlineData("/manifest.webmanifest", 3600, false)]
    public async Task Static_files_are_cached_only_as_long_as_it_is_safe(string url, int seconds, bool immutable)
    {
        var res = await factory.CreateClient().GetAsync(url);
        res.EnsureSuccessStatusCode();
        var cc = res.Headers.CacheControl!;
        Assert.True(cc.Public, cc.ToString());
        Assert.Equal(TimeSpan.FromSeconds(seconds), cc.MaxAge);
        Assert.Equal(immutable, cc.Extensions.Any(e => e.Name == "immutable"));
        // a later visit asks "changed?" and gets a short answer instead of the whole file
        Assert.NotNull(res.Headers.ETag);
        var again = new HttpRequestMessage(HttpMethod.Get, url);
        again.Headers.IfNoneMatch.Add(res.Headers.ETag!);
        Assert.Equal(System.Net.HttpStatusCode.NotModified, (await factory.CreateClient().SendAsync(again)).StatusCode);
    }
}
