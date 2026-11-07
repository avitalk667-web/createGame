using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Data;
using PortalX.Server.Game;
using PortalX.Server.Security;

namespace PortalX.Tests;

/// <summary>
/// The free game is limited per browser, with the address only as a looser safety net: hundreds of people behind one
/// phone-network or Wi-Fi address can all play, one person cannot open game after game, pressing again returns the
/// same game, the wait in the message is the real one, and paid games are not touched by any of it.
/// </summary>
[Collection(DatabaseCollection.Name)]
public class FreeGameLimitTests : IAsyncDisposable
{
    private readonly List<WebApplicationFactory<Program>> _sites = new();
    // at most this many requests at the same moment: the local test database accepts 100 connections in all
    private readonly SemaphoreSlim _parallel = new(20);

    public async ValueTask DisposeAsync()
    {
        foreach (var s in _sites) await s.DisposeAsync();
    }

    private async Task<T> Limited<T>(Func<Task<T>> work)
    {
        await _parallel.WaitAsync();
        try { return await work(); } finally { _parallel.Release(); }
    }

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const string FreeGame = "/api/products/gate-of-secrets/free-game";
    private readonly HubIntegrationTests.Factory _factory;

    public FreeGameLimitTests(HubIntegrationTests.Factory factory) => _factory = factory;

    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    /// <summary>The site with the real production limits (the shared test server raises them for other tests).</summary>
    private (WebApplicationFactory<Program> F, Clock Clock) Site(Dictionary<string, string?>? overrides = null)
    {
        var clock = new Clock();
        var limits = new Dictionary<string, string?>
        {
            ["RateLimits:FreeGamesPerHour"] = "300",
            ["RateLimits:FreeGamesPerBrowserPerHour"] = "5",
            ["RateLimits:FreeGamesNewBrowserPerHour"] = "30",
            ["RateLimits:JoinPerMinute"] = "1200",
            ["RateLimits:JoinPerBrowserPerMinute"] = "120",
        };
        foreach (var (k, v) in overrides ?? new()) limits[k] = v;
        var f = _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(limits));
            b.ConfigureTestServices(s => s.AddSingleton(new UsageLimiter(clock)));
        });
        _sites.Add(f);
        return (f, clock);
    }

    private static int _net = 10;

    /// <summary>A fresh public address for one test, as Render's proxy would append it.</summary>
    private static string Address() => $"198.51.{100 + Interlocked.Increment(ref _net) % 50}.{Interlocked.Increment(ref _net) % 250 + 1}";

    /// <summary>One browser (its own cookies) on the given address. It loads the site first, as a visitor does.</summary>
    private static async Task<HttpClient> BrowserAsync(WebApplicationFactory<Program> f, string ip, bool cookies = true, bool visit = true)
    {
        var http = f.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = cookies });
        http.DefaultRequestHeaders.Add("X-Forwarded-For", ip);
        if (visit) (await http.GetAsync("/api/products")).EnsureSuccessStatusCode();
        return http;
    }

    private static async Task<JsonElement> Body(HttpResponseMessage r) => JsonSerializer.Deserialize<JsonElement>(await r.Content.ReadAsStringAsync(), Json);

    private static async Task<(string Code, string Claim)> OpenAsync(HttpClient http)
    {
        var r = await http.PostAsync(FreeGame, null);
        Assert.True(r.StatusCode == HttpStatusCode.OK, $"{(int)r.StatusCode}: {await r.Content.ReadAsStringAsync()}");
        var b = await Body(r);
        return (b.GetProperty("code").GetString()!, b.GetProperty("hostClaim").GetString()!);
    }

    private static async Task StartAsync(WebApplicationFactory<Program> f, string code)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        var room = await db.Rooms.FirstAsync(r => r.Code == code);
        room.FirstStartedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }

    private static async Task<int> RoomsAsync(WebApplicationFactory<Program> f, IEnumerable<string> codes)
    {
        using var scope = f.Services.CreateScope();
        var list = codes.ToList();
        return await scope.ServiceProvider.GetRequiredService<PortalDbContext>().Rooms.CountAsync(r => list.Contains(r.Code));
    }

    // ------------------------------------------------------------------ many people, one address

    [Fact]
    public async Task Two_hundred_people_on_one_address_all_open_and_enter_a_free_game()
    {
        var (f, _) = Site();
        var ip = Address();
        var browsers = new List<HttpClient>();
        for (var i = 0; i < 200; i++) browsers.Add(await BrowserAsync(f, ip));

        var games = new List<(string Code, string Claim)>();
        foreach (var batch in browsers.Chunk(20)) games.AddRange(await Task.WhenAll(batch.Select(OpenAsync)));
        Assert.Equal(200, games.Select(g => g.Code).Distinct().Count());
        Assert.Equal(200, await RoomsAsync(f, games.Select(g => g.Code)));

        // each enters its own game, all at once: game details, seat check, join (the requests of the join page)
        var entries = browsers.Zip(games).Select(x => Limited(async () =>
        {
            var (http, (code, claim)) = x;
            Assert.Equal(HttpStatusCode.OK, (await http.GetAsync($"/api/rooms/{code}")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await http.GetAsync($"/api/rooms/{code}/seat")).StatusCode);
            var join = await http.PostAsJsonAsync($"/api/rooms/{code}/players", new { nickname = "שחקן", characterId = GameEngine.Characters[0], appearance = "{}", hostClaim = claim });
            Assert.True(join.StatusCode == HttpStatusCode.OK, await join.Content.ReadAsStringAsync());
            return true;
        }));
        await Task.WhenAll(entries);
    }

    [Fact]
    public async Task Friends_of_one_host_on_the_same_address_all_join_without_a_refusal()
    {
        var (f, _) = Site();
        var ip = Address();
        // 50 groups of four on one network, every player in their own browser
        var hosts = new List<(string Code, string Claim)>();
        for (var i = 0; i < 50; i++) hosts.Add(await OpenAsync(await BrowserAsync(f, ip)));
        var joins = hosts.SelectMany(g => Enumerable.Range(0, 4).Select(n => Limited(async () =>
        {
            var http = await BrowserAsync(f, ip, visit: false);
            await http.GetAsync($"/api/rooms/{g.Code}");
            var r = await http.PostAsJsonAsync($"/api/rooms/{g.Code}/players",
                new { nickname = "שחקן" + n, characterId = GameEngine.Characters[n], appearance = "{}", hostClaim = n == 0 ? g.Claim : null });
            return r.StatusCode;
        })));
        var codes = await Task.WhenAll(joins);
        Assert.All(codes, c => Assert.Equal(HttpStatusCode.OK, c));
    }

    // ------------------------------------------------------------------ one person

    [Fact]
    public async Task One_browser_is_stopped_after_five_an_hour_with_the_real_wait_and_others_are_not()
    {
        var (f, clock) = Site();
        var ip = Address();
        var me = await BrowserAsync(f, ip);
        for (var i = 0; i < 5; i++)
        {
            var (code, _) = await OpenAsync(me);
            await StartAsync(f, code); // played: pressing again now opens a new game
        }

        var refused = await me.PostAsync(FreeGame, null);
        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
        var body = await Body(refused);
        Assert.Equal(UsageLimits.FreeBrowserCode, body.GetProperty("code").GetString());
        Assert.Equal("פתחתם כבר 5 משחקי ניסיון בשעה האחרונה. אפשר לפתוח משחק ניסיון נוסף בעוד שעה.", body.GetProperty("message").GetString());
        Assert.DoesNotContain("דקה ונסו", body.GetProperty("message").GetString());

        // 37 minutes later: 23 minutes left, said exactly, also in Retry-After
        clock.Now += TimeSpan.FromMinutes(37);
        refused = await me.PostAsync(FreeGame, null);
        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
        Assert.Contains("בעוד 23 דקות", (await Body(refused)).GetProperty("message").GetString());
        Assert.Equal(TimeSpan.FromMinutes(23), refused.Headers.RetryAfter?.Delta);

        // someone else on the same network is not affected
        await OpenAsync(await BrowserAsync(f, ip));

        // an hour after the first one, the first place is free again
        clock.Now += TimeSpan.FromMinutes(23);
        await OpenAsync(me);
    }

    [Fact]
    public async Task Requests_without_a_browser_id_fall_under_the_address_limit()
    {
        var (f, _) = Site();
        var ip = Address();
        // a script that never keeps cookies, or deletes them before every press
        var noCookies = await BrowserAsync(f, ip, cookies: false);
        for (var i = 0; i < 30; i++) await OpenAsync(noCookies);
        var refused = await noCookies.PostAsync(FreeGame, null);
        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
        var body = await Body(refused);
        Assert.Equal(UsageLimits.FreeNetworkCode, body.GetProperty("code").GetString());
        Assert.Contains("בעוד שעה", body.GetProperty("message").GetString());

        // an invented id is no id: the same limit
        var forged = f.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        forged.DefaultRequestHeaders.Add("X-Forwarded-For", ip);
        forged.DefaultRequestHeaders.Add("Cookie", BrowserIdentity.Cookie + "=AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA");
        Assert.Equal(HttpStatusCode.TooManyRequests, (await forged.PostAsync(FreeGame, null)).StatusCode);

        // people with a browser id on the same network still play
        await OpenAsync(await BrowserAsync(f, ip));
        await OpenAsync(await BrowserAsync(f, ip));
    }

    [Fact]
    public async Task The_address_limit_is_only_a_safety_net_for_a_whole_network()
    {
        // a small net, to reach it quickly (production: 300 an hour)
        var (f, _) = Site(new() { ["RateLimits:FreeGamesPerHour"] = "12" });
        var ip = Address();
        for (var i = 0; i < 12; i++) await OpenAsync(await BrowserAsync(f, ip));
        var refused = await (await BrowserAsync(f, ip)).PostAsync(FreeGame, null);
        Assert.Equal(HttpStatusCode.TooManyRequests, refused.StatusCode);
        Assert.Equal(UsageLimits.FreeNetworkCode, (await Body(refused)).GetProperty("code").GetString());
        // another network is not affected
        await OpenAsync(await BrowserAsync(f, Address()));
    }

    [Fact]
    public async Task Refusals_do_not_use_up_anything()
    {
        var (f, _) = Site(new() { ["RateLimits:FreeGamesPerHour"] = "6" });
        var ip = Address();
        var me = await BrowserAsync(f, ip);
        for (var i = 0; i < 5; i++) await StartAsync(f, (await OpenAsync(me)).Code);
        // pressing again and again past my own limit does not take the network's places
        for (var i = 0; i < 20; i++) Assert.Equal(HttpStatusCode.TooManyRequests, (await me.PostAsync(FreeGame, null)).StatusCode);
        await OpenAsync(await BrowserAsync(f, ip));
    }

    // ------------------------------------------------------------------ pressing again

    [Fact]
    public async Task Pressing_again_refreshing_or_retrying_returns_the_same_game_until_it_starts()
    {
        var (f, _) = Site();
        var ip = Address();
        var me = await BrowserAsync(f, ip);
        var first = await OpenAsync(me);

        // back, refresh, a retry after a network error: one after another
        for (var i = 0; i < 10; i++) Assert.Equal(first, await OpenAsync(me));
        // a double press and a second tab: at the same moment
        var together = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => OpenAsync(me)));
        Assert.All(together, g => Assert.Equal(first, g));
        Assert.Equal(1, await RoomsAsync(f, together.Select(g => g.Code).Append(first.Code)));

        // presses that returned the same game were not counted: four more new games still fit in the hour
        await StartAsync(f, first.Code);
        for (var i = 0; i < 4; i++)
        {
            var next = await OpenAsync(me);
            Assert.NotEqual(first.Code, next.Code);
            await StartAsync(f, next.Code);
        }
        Assert.Equal(HttpStatusCode.TooManyRequests, (await me.PostAsync(FreeGame, null)).StatusCode);
    }

    [Fact]
    public async Task A_reused_game_never_gives_its_host_key_to_another_browser()
    {
        var (f, _) = Site();
        var ip = Address();
        var a = await BrowserAsync(f, ip);
        var b = await BrowserAsync(f, ip);
        var gameA = await OpenAsync(a);
        var gameB = await OpenAsync(b);
        Assert.NotEqual(gameA.Code, gameB.Code);
        Assert.NotEqual(gameA.Claim, gameB.Claim);
        Assert.Equal(gameB, await OpenAsync(b));

        // the host enters with the key; someone who has only the code — or the key of another game — is a player
        var host = await Body(await a.PostAsJsonAsync($"/api/rooms/{gameA.Code}/players",
            new { nickname = "מארחת", characterId = GameEngine.Characters[0], appearance = "{}", hostClaim = gameA.Claim }));
        var guest = await BrowserAsync(f, ip);
        var joined = await Body(await guest.PostAsJsonAsync($"/api/rooms/{gameA.Code}/players",
            new { nickname = "אורח", characterId = GameEngine.Characters[1], appearance = "{}" }));
        var other = await BrowserAsync(f, ip);
        var withWrongKey = await Body(await other.PostAsJsonAsync($"/api/rooms/{gameA.Code}/players",
            new { nickname = "אחר", characterId = GameEngine.Characters[2], appearance = "{}", hostClaim = gameB.Claim }));
        using var scope = f.Services.CreateScope();
        var room = await scope.ServiceProvider.GetRequiredService<PortalDbContext>().Rooms.AsNoTracking().FirstAsync(r => r.Code == gameA.Code);
        Assert.Equal(host.GetProperty("playerId").GetGuid(), room.HostPlayerId);
        Assert.NotEqual(joined.GetProperty("playerId").GetGuid(), room.HostPlayerId);
        Assert.NotEqual(withWrongKey.GetProperty("playerId").GetGuid(), room.HostPlayerId);
        // and the guest pressing "free game" gets a game of its own, never A's game or A's key
        var guestGame = await OpenAsync(guest);
        Assert.NotEqual(gameA.Code, guestGame.Code);
        Assert.NotEqual(gameA.Claim, guestGame.Claim);
    }

    // ------------------------------------------------------------------ the address behind Render's proxy

    private static HttpContext Request(string? peer, string? forwardedFor)
    {
        var ctx = new DefaultHttpContext();
        if (peer != null) ctx.Connection.RemoteIpAddress = IPAddress.Parse(peer);
        if (forwardedFor != null) ctx.Request.Headers["X-Forwarded-For"] = forwardedFor;
        return ctx;
    }

    [Theory]
    // Render appends the address it received the request from; what the visitor wrote stays on the left
    [InlineData("10.1.2.3", "203.0.113.9", "203.0.113.9")]
    [InlineData("10.1.2.3", "6.6.6.6, 203.0.113.9", "203.0.113.9")]
    [InlineData("10.1.2.3", "1.1.1.1, 2.2.2.2, 203.0.113.9", "203.0.113.9")]
    // a Cloudflare hop and an internal hop after the visitor are skipped
    [InlineData("10.1.2.3", "6.6.6.6, 203.0.113.9, 162.158.10.20, 10.0.0.7", "203.0.113.9")]
    // a visitor writing an internal address cannot hide behind it
    [InlineData("10.1.2.3", "10.9.9.9, 203.0.113.9", "203.0.113.9")]
    [InlineData("10.1.2.3", "203.0.113.9:51234", "203.0.113.9")]
    [InlineData("10.1.2.3", "2001:db8:1:2::77", "2001:db8:1:2::77")]
    // no proxy (local run): the connection itself
    [InlineData("127.0.0.1", null, "127.0.0.1")]
    public void The_visitors_address_is_the_rightmost_one_that_is_not_a_proxy(string peer, string? forwardedFor, string expected)
    {
        Assert.Equal(IPAddress.Parse(expected), ClientIp.Resolve(Request(peer, forwardedFor), Array.Empty<System.Net.IPNetwork>()));
    }

    [Fact]
    public void Different_people_get_different_keys_and_one_ipv6_device_gets_one()
    {
        var a = Request("10.0.0.1", "203.0.113.9");
        a.Connection.RemoteIpAddress = ClientIp.Resolve(a, Array.Empty<System.Net.IPNetwork>());
        var b = Request("10.0.0.1", "203.0.113.10");
        b.Connection.RemoteIpAddress = ClientIp.Resolve(b, Array.Empty<System.Net.IPNetwork>());
        Assert.NotEqual(ClientIp.Key(a), ClientIp.Key(b));

        var v6a = Request("2001:db8:1:2::77", null);
        var v6b = Request("2001:db8:1:2:aaaa::1", null);
        var v6c = Request("2001:db8:1:3::77", null);
        Assert.Equal(ClientIp.Key(v6a), ClientIp.Key(v6b));
        Assert.NotEqual(ClientIp.Key(v6a), ClientIp.Key(v6c));
    }

    [Fact]
    public async Task A_forged_forwarded_address_does_not_make_a_new_person()
    {
        var (f, _) = Site(new() { ["RateLimits:FreeGamesNewBrowserPerHour"] = "3" });
        var real = Address();
        for (var i = 0; i < 4; i++)
        {
            var http = f.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
            // a different invented address each time, then the real one Render appends
            http.DefaultRequestHeaders.Add("X-Forwarded-For", $"9.9.9.{i + 1}, {real}");
            var r = await http.PostAsync(FreeGame, null);
            Assert.Equal(i < 3 ? HttpStatusCode.OK : HttpStatusCode.TooManyRequests, r.StatusCode);
        }
    }

    // ------------------------------------------------------------------ messages and paid games

    [Theory]
    [InlineData(10, "בעוד פחות מדקה")]
    [InlineData(60, "בעוד דקה")]
    [InlineData(61, "בעוד שתי דקות")]
    [InlineData(23 * 60, "בעוד 23 דקות")]
    [InlineData(3600, "בעוד שעה")]
    public void The_wait_is_said_in_words(int seconds, string expected) => Assert.Equal(expected, UsageLimiter.Wait(TimeSpan.FromSeconds(seconds)));

    [Fact]
    public async Task Other_limits_say_the_real_wait_too()
    {
        var (f, _) = Site(new() { ["RateLimits:CouponPerMinute"] = "1" });
        var http = await BrowserAsync(f, Address());
        await http.PostAsJsonAsync("/api/coupons/check", new { productId = "x", code = "x" });
        var r = await http.PostAsJsonAsync("/api/coupons/check", new { productId = "x", code = "x" });
        Assert.Equal(HttpStatusCode.TooManyRequests, r.StatusCode);
        Assert.NotNull(r.Headers.RetryAfter);
        Assert.StartsWith("יותר מדי ניסיונות בזמן קצר. נסו שוב בעוד", (await Body(r)).GetProperty("message").GetString());
    }

    [Fact]
    public async Task Paid_games_are_not_touched_by_the_free_game_limits()
    {
        var (f, _) = Site(new() { ["RateLimits:FreeGamesPerHour"] = "1" });
        await TestPurchase.EnsureProductAsync(f.Services);
        var ip = Address();
        var buyer = await BrowserAsync(f, ip);
        // this browser and this whole network used up their free games
        await StartAsync(f, (await OpenAsync(buyer)).Code);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await buyer.PostAsync(FreeGame, null)).StatusCode);

        // buying, paying and opening the paid game work exactly as before
        var (code, claim) = await TestPurchase.PaidRoomAsync(buyer, f.Services);
        Assert.Equal(HttpStatusCode.OK, (await buyer.GetAsync($"/api/rooms/{code}")).StatusCode);
        var host = await buyer.PostAsJsonAsync($"/api/rooms/{code}/players", new { nickname = "קונה", characterId = GameEngine.Characters[0], appearance = "{}", hostClaim = claim });
        Assert.Equal(HttpStatusCode.OK, host.StatusCode);
        // and friends on the same network join the paid game
        for (var i = 1; i < 4; i++)
        {
            var friend = await BrowserAsync(f, ip);
            var r = await friend.PostAsJsonAsync($"/api/rooms/{code}/players", new { nickname = "חבר" + i, characterId = GameEngine.Characters[i], appearance = "{}" });
            Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        }
    }
}
