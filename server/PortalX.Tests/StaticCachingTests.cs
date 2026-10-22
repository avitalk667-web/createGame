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
}
