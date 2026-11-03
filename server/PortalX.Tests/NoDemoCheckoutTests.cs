using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Admin;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using PortalX.Server.Payments;
using static PortalX.Tests.TestPurchase;

namespace PortalX.Tests;

/// <summary>
/// The demo checkout was removed: no setting brings it back, no route opens a paid game without a verified payment,
/// old demo games stay on record but closed, and the real free game keeps working.
/// </summary>
[Collection(DatabaseCollection.Name)]
public class NoDemoCheckoutTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HubIntegrationTests.Factory _factory;

    public NoDemoCheckoutTests(HubIntegrationTests.Factory factory) => _factory = factory;

    /// <summary>
    /// A server like the second Render service: Production, no payment provider, and the old demo settings still present.
    /// </summary>
    private WebApplicationFactory<Program> SecondaryService() => _factory.WithWebHostBuilder(b =>
    {
        b.UseEnvironment("Production");
        b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Payments:Provider"] = "none", ["PAYMENTS_MODE"] = "Test", ["ENABLE_TEST_CHECKOUT"] = "true",
        }));
    });

    private static async Task<T> DbAsync<T>(WebApplicationFactory<Program> f, Func<PortalDbContext, Task<T>> q)
    {
        using var scope = f.Services.CreateScope();
        return await q(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
    }

    private static async Task<JsonElement> Body(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>(Json);

    [Fact]
    public void No_route_on_the_server_belongs_to_the_demo_checkout()
    {
        using var f = SecondaryService();
        var routes = f.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>().Select(e => e.RoutePattern.RawText ?? "").ToList();
        Assert.NotEmpty(routes);
        Assert.DoesNotContain(routes, r => r.Contains("test-game", StringComparison.OrdinalIgnoreCase) || r.Contains("demo", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task The_old_settings_and_direct_api_calls_open_nothing_on_a_server_like_the_second_service()
    {
        using var f = SecondaryService();
        var http = f.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });
        await EnsureProductAsync(f.Services);
        var entitlements = await DbAsync(f, db => db.Entitlements.CountAsync());
        var rooms = await DbAsync(f, db => db.Rooms.CountAsync());

        foreach (var id in new[] { ProductId, "hanukkah-oil", "last-portal", "gate-of-secrets" })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await http.PostAsync($"/api/products/{id}/test-game", null)).StatusCode);
            var withBody = new HttpRequestMessage(HttpMethod.Post, $"/api/products/{id}/test-game")
            {
                Content = JsonContent.Create(new { test = true, paymentsMode = "Test", enableTestCheckout = true }),
            };
            withBody.Headers.Add("X-Payments-Mode", "Test");
            Assert.Equal(HttpStatusCode.NotFound, (await http.SendAsync(withBody)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync($"/api/products/{id}/test-game")).StatusCode);
        }
        // a paid game can't be opened as if it were free, and no order can start without a provider
        Assert.Equal(HttpStatusCode.Forbidden, (await http.PostAsync($"/api/products/{ProductId}/free-game", null)).StatusCode);
        Assert.Equal((HttpStatusCode)503, (await http.PostAsJsonAsync("/api/orders", new { productId = ProductId })).StatusCode);

        Assert.Equal(entitlements, await DbAsync(f, db => db.Entitlements.CountAsync()));
        Assert.Equal(rooms, await DbAsync(f, db => db.Rooms.CountAsync()));
    }

    [Fact]
    public async Task The_public_product_data_says_nothing_about_a_demo()
    {
        using var f = SecondaryService();
        var http = f.CreateClient();
        await EnsureProductAsync(f.Services);
        var list = await Body(await http.GetAsync("/api/products"));
        Assert.NotEmpty(list.EnumerateArray());
        foreach (var p in list.EnumerateArray()) Assert.False(p.TryGetProperty("testCheckout", out _));
    }

    [Fact]
    public async Task An_order_never_paid_opens_no_game_through_the_sandbox_either_in_production()
    {
        using var f = SecondaryService();
        var http = f.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync("/api/sandbox/checkout/sbx_x")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await http.PostAsJsonAsync("/api/sandbox/checkout/sbx_x", new { outcome = "approve" })).StatusCode);
    }

    private static async Task<string> LegacyDemoRoomAsync(WebApplicationFactory<Program> f, string productId, RoomPhase phase)
    {
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        var rooms = scope.ServiceProvider.GetRequiredService<RoomService>();
        var product = await db.Products.AsNoTracking().FirstAsync(p => p.Id == productId);
        var ent = new Entitlement
        {
            Id = Guid.NewGuid(), ProductId = product.Id, Source = EntitlementSource.TestCheckout, SessionsAllowed = 1, SessionsUsed = 1, IsTest = true, CreatedAt = DateTime.UtcNow,
        };
        db.Entitlements.Add(ent);
        await db.SaveChangesAsync();
        var (room, _) = await rooms.CreateRoomAsync(product.ScenarioId!, r =>
        {
            r.ProductId = product.Id;
            r.EntitlementId = ent.Id;
            r.AccessSource = RoomService.LegacyDemoAccess;
            r.MaxPlayers = 4;
        });
        await db.Rooms.Where(r => r.Id == room.Id).ExecuteUpdateAsync(s => s.SetProperty(r => r.Phase, phase));
        return room.Code;
    }

    [Theory]
    [InlineData(RoomPhase.Lobby)]
    [InlineData(RoomPhase.Playing)]
    public async Task An_old_demo_game_that_did_not_finish_is_closed_but_stays_on_record(RoomPhase phase)
    {
        using var f = SecondaryService();
        await EnsureProductAsync(f.Services);
        var code = await LegacyDemoRoomAsync(f, ProductId, phase);
        var http = f.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });

        var info = await Body(await http.GetAsync($"/api/rooms/{code}"));
        Assert.False(info.GetProperty("canJoin").GetBoolean());
        var join = await http.PostAsJsonAsync($"/api/rooms/{code}/players", new { nickname = "Late", characterId = "explorer", appearance = "{}" });
        Assert.Equal(HttpStatusCode.BadRequest, join.StatusCode);
        Assert.Equal(RoomService.DemoClosedCode, (await Body(join)).GetProperty("code").GetString());
        var room = await DbAsync(f, db => db.Rooms.AsNoTracking().SingleAsync(r => r.Code == code));
        Assert.Equal(phase, room.Phase);
    }

    [Fact]
    public async Task Old_demo_games_stay_in_the_admin_history_and_never_count_as_sales()
    {
        var f = _factory;
        var admin = f.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });
        (await admin.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        admin.DefaultRequestHeaders.Add(AdminAuth.CsrfHeader, "1");
        await EnsureProductAsync(f.Services);
        var before = await Body(await admin.GetAsync("/api/admin/dashboard"));
        Assert.False(before.TryGetProperty("demoCheckoutEnabled", out _));

        var code = await LegacyDemoRoomAsync(f, ProductId, RoomPhase.Lobby);
        var after = await Body(await admin.GetAsync("/api/admin/dashboard"));
        Assert.Equal(before.GetProperty("revenue").GetProperty("gross").GetDecimal(), after.GetProperty("revenue").GetProperty("gross").GetDecimal());
        Assert.Equal(before.GetProperty("revenue").GetProperty("paidCount").GetInt32(), after.GetProperty("revenue").GetProperty("paidCount").GetInt32());
        Assert.Equal(before.GetProperty("games").GetProperty("demo").GetInt32() + 1, after.GetProperty("games").GetProperty("demo").GetInt32());

        var games = await Body(await admin.GetAsync($"/api/admin/games?access={RoomService.LegacyDemoAccess}&includeTest=true"));
        Assert.Contains(games.EnumerateArray(), g => g.GetProperty("code").GetString() == code && g.GetProperty("owner").GetString() == "הדגמה ישנה (סגור)");
    }

    [Fact]
    public async Task The_real_free_game_still_opens_and_can_be_joined_for_free()
    {
        using var f = SecondaryService();
        var http = f.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });
        var free = await DbAsync(f, db => db.Products.AsNoTracking().FirstAsync(p => p.Id == "gate-of-secrets"));
        Assert.True(free.IsFree);
        var opened = await http.PostAsync("/api/products/gate-of-secrets/free-game", null);
        Assert.Equal(HttpStatusCode.OK, opened.StatusCode);
        var body = await Body(opened);
        var code = body.GetProperty("code").GetString()!;
        var join = await http.PostAsJsonAsync($"/api/rooms/{code}/players",
            new { nickname = "Free", characterId = "explorer", appearance = "{}", hostClaim = body.GetProperty("hostClaim").GetString() });
        Assert.Equal(HttpStatusCode.OK, join.StatusCode);
        Assert.Equal("free-sample", await DbAsync(f, db => db.Rooms.Where(r => r.Code == code).Select(r => r.AccessSource).SingleAsync()));
        Assert.False(await DbAsync(f, db => db.Orders.AnyAsync(o => o.ProductId == "gate-of-secrets" && o.CreatedAt > DateTime.UtcNow.AddMinutes(-1))));
    }
}
