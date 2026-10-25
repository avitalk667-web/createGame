using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Admin;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Payments;

namespace PortalX.Tests;

/// <summary>
/// Demo checkout (home page and demo payment spec, part B): paid games open without payment only while the server's
/// own settings allow it; demo games are test entitlements, never orders or revenue, and are reported apart.
/// </summary>
[Collection(DatabaseCollection.Name)]
public class DemoCheckoutTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HubIntegrationTests.Factory _factory;

    public DemoCheckoutTests(HubIntegrationTests.Factory factory) => _factory = factory;

    /// <summary>The same site with demo mode switched on (or with only some of its settings).</summary>
    private WebApplicationFactory<Program> With(Dictionary<string, string?> settings) =>
        _factory.WithWebHostBuilder(b => b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(settings)));

    private WebApplicationFactory<Program> DemoOn() =>
        With(new() { ["PAYMENTS_MODE"] = "Test", ["ENABLE_TEST_CHECKOUT"] = "true" });

    private static async Task<JsonElement> Body(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>(Json);

    private static async Task<T> DbAsync<T>(WebApplicationFactory<Program> f, Func<PortalDbContext, Task<T>> q)
    {
        using var scope = f.Services.CreateScope();
        return await q(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
    }

    private static async Task<JsonElement> Product(HttpClient http, string id) => await Body(await http.GetAsync($"/api/products/{id}"));

    [Fact]
    public async Task With_demo_mode_off_there_is_no_demo_button_and_the_server_refuses_whatever_the_browser_sends()
    {
        var http = _factory.CreateClient();
        Assert.False((await Product(http, "hanukkah-oil")).GetProperty("testCheckout").GetBoolean());
        var rooms = await DbAsync(_factory, db => db.Rooms.CountAsync());

        // the browser cannot switch it on: not by a flag in the body, the query or a header
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/products/hanukkah-oil/test-game?test=true&PAYMENTS_MODE=Test")
        {
            Content = JsonContent.Create(new { test = true, paymentsMode = "Test", enableTestCheckout = true }),
        };
        req.Headers.Add("X-Payments-Mode", "Test");
        var r = await http.SendAsync(req);
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        Assert.Equal("test-checkout-off", (await Body(r)).GetProperty("code").GetString());
        Assert.Equal(rooms, await DbAsync(_factory, db => db.Rooms.CountAsync()));
    }

    [Theory]
    [InlineData("Test", null)]
    [InlineData(null, "true")]
    [InlineData("Live", "true")]
    [InlineData("Test", "false")]
    public async Task Both_server_settings_are_needed(string? mode, string? show)
    {
        using var f = With(new() { ["PAYMENTS_MODE"] = mode, ["ENABLE_TEST_CHECKOUT"] = show });
        var http = f.CreateClient();
        Assert.False((await Product(http, "last-portal")).GetProperty("testCheckout").GetBoolean());
        Assert.Equal(HttpStatusCode.Forbidden, (await http.PostAsync("/api/products/last-portal/test-game", null)).StatusCode);
    }

    [Theory]
    [InlineData("hanukkah-oil")]
    [InlineData("last-portal")]
    public async Task With_demo_mode_on_every_paid_game_opens_without_payment_and_can_be_played(string productId)
    {
        using var f = DemoOn();
        var http = f.CreateClient();
        Assert.True((await Product(http, productId)).GetProperty("testCheckout").GetBoolean());
        var orders = await DbAsync(f, db => db.Orders.CountAsync());

        var res = await http.PostAsync($"/api/products/{productId}/test-game", null);
        var body = await Body(res);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(TestCheckout.OpenedMessage, body.GetProperty("message").GetString());
        var code = body.GetProperty("code").GetString()!;

        // a test entitlement for the chosen game only — no order, no payment record
        var room = await DbAsync(f, db => db.Rooms.AsNoTracking().FirstAsync(r => r.Code == code));
        Assert.Equal(TestCheckout.AccessSource, room.AccessSource);
        Assert.Equal(productId, room.ProductId);
        var ent = await DbAsync(f, db => db.Entitlements.AsNoTracking().FirstAsync(e => e.Id == room.EntitlementId));
        Assert.True(ent.IsTest);
        Assert.Equal(EntitlementSource.TestCheckout, ent.Source);
        Assert.Null(ent.OrderId);
        Assert.Equal(productId, ent.ProductId);
        Assert.Equal(1, ent.SessionsAllowed);
        Assert.Equal(orders, await DbAsync(f, db => db.Orders.CountAsync()));

        // the host joins and starts the game: it really plays
        var join = await http.PostAsJsonAsync($"/api/rooms/{code}/players",
            new { nickname = "Demo", characterId = "explorer", appearance = "{}", hostClaim = body.GetProperty("hostClaim").GetString() });
        Assert.True(join.IsSuccessStatusCode);
        var token = (await Body(join)).GetProperty("token").GetString()!;
        var server = f.Server;
        await using var conn = new HubConnectionBuilder()
            .WithUrl(new Uri(server.BaseAddress, "/hubs/game"), o =>
            {
                o.Transports = HttpTransportType.LongPolling;
                o.HttpMessageHandlerFactory = _ => server.CreateHandler();
            }).Build();
        await conn.StartAsync();
        Assert.True((await conn.InvokeAsync<JsonElement>("Connect", token)).GetProperty("ok").GetBoolean());
        // The Last Portal needs a second participant (connected and ready) before it can start
        HubConnection? guest = null;
        if (productId == "last-portal")
        {
            Assert.Equal("not-ready", (await conn.InvokeAsync<JsonElement>("StartGame")).GetProperty("code").GetString());
            var j2 = await http.PostAsJsonAsync($"/api/rooms/{code}/players", new { nickname = "Demo2", characterId = "scholar", appearance = "{}" });
            var t2 = (await Body(j2)).GetProperty("token").GetString()!;
            guest = new HubConnectionBuilder()
                .WithUrl(new Uri(server.BaseAddress, "/hubs/game"), o =>
                {
                    o.Transports = HttpTransportType.LongPolling;
                    o.HttpMessageHandlerFactory = _ => server.CreateHandler();
                }).Build();
            await guest.StartAsync();
            Assert.True((await guest.InvokeAsync<JsonElement>("Connect", t2)).GetProperty("ok").GetBoolean());
            Assert.True((await guest.InvokeAsync<JsonElement>("SetReady", true)).GetProperty("ok").GetBoolean());
        }
        var start = await conn.InvokeAsync<JsonElement>("StartGame");
        if (guest != null) await guest.DisposeAsync();
        Assert.True(start.GetProperty("ok").GetBoolean(), start.ToString());
    }

    [Fact]
    public async Task Demo_mode_does_not_apply_to_the_free_game_or_unknown_games()
    {
        using var f = DemoOn();
        var http = f.CreateClient();
        Assert.False((await Product(http, "gate-of-secrets")).GetProperty("testCheckout").GetBoolean());
        Assert.Equal(HttpStatusCode.Conflict, (await http.PostAsync("/api/products/gate-of-secrets/test-game", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await http.PostAsync("/api/products/no-such-game/test-game", null)).StatusCode);
    }

    [Fact]
    public async Task Demo_games_are_reported_apart_and_never_count_as_revenue_or_sales()
    {
        using var f = DemoOn();
        var admin = f.CreateClient();
        (await admin.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        admin.DefaultRequestHeaders.Add(AdminAuth.CsrfHeader, "1");
        var before = await Body(await admin.GetAsync("/api/admin/dashboard"));
        Assert.True(before.GetProperty("demoCheckoutEnabled").GetBoolean());

        var code = (await Body(await f.CreateClient().PostAsync("/api/products/hanukkah-oil/test-game", null))).GetProperty("code").GetString()!;
        var after = await Body(await admin.GetAsync("/api/admin/dashboard"));
        decimal Gross(JsonElement d) => d.GetProperty("revenue").GetProperty("gross").GetDecimal();
        int Games(JsonElement d, string k) => d.GetProperty("games").GetProperty(k).GetInt32();
        Assert.Equal(Gross(before), Gross(after));
        Assert.Equal(before.GetProperty("revenue").GetProperty("paidCount").GetInt32(), after.GetProperty("revenue").GetProperty("paidCount").GetInt32());
        Assert.Equal(Games(before, "opened"), Games(after, "opened"));
        Assert.Equal(Games(before, "adminFree"), Games(after, "adminFree"));
        Assert.Equal(Games(before, "demo") + 1, Games(after, "demo"));
        var row = after.GetProperty("byProduct").EnumerateArray().First(p => p.GetProperty("productId").GetString() == "hanukkah-oil");
        var rowBefore = before.GetProperty("byProduct").EnumerateArray().First(p => p.GetProperty("productId").GetString() == "hanukkah-oil");
        Assert.Equal(rowBefore.GetProperty("games").GetInt32(), row.GetProperty("games").GetInt32());

        // the games table names it as a demo game, apart from purchases and admin free games
        var games = await Body(await admin.GetAsync("/api/admin/games?access=test-checkout&includeTest=true"));
        var mine = games.EnumerateArray().First(g => g.GetProperty("code").GetString() == code);
        Assert.Equal("test-checkout", mine.GetProperty("access").GetString());
        Assert.True(mine.GetProperty("isTest").GetBoolean());
        Assert.Equal("מצב הדגמה — ללא חיוב", mine.GetProperty("owner").GetString());
    }
}
