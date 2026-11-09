using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Admin;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;
using static PortalX.Tests.TestPurchase;

namespace PortalX.Tests;

/// <summary>
/// "מבוך האבן" is its own paid game (39 ₪) with its own scenario, built from the upgraded rooms; the free game
/// "שער הסודות" keeps its original content. Each loads its own content, and buying the Stone Maze opens only the Stone Maze.
/// </summary>
[Collection(DatabaseCollection.Name)]
public class StoneMazeSeparationTests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HubIntegrationTests.Factory _factory;
    public StoneMazeSeparationTests(HubIntegrationTests.Factory factory) => _factory = factory;

    private static readonly string[] UpgradedTypes = ["pendulum", "assembly", "runechain", "cabinetlock", "keychest", "exitdoor", "levers", "railway", "gravity"];

    // ------------------------------------------------------------------ content

    [Fact]
    public void Each_game_loads_its_own_content()
    {
        var maze = Catalog.Get("stone-maze");
        var free = Catalog.Get("gate-of-secrets");
        Assert.Equal("מבוך האבן", maze.Name);
        Assert.Equal("אתגר לחדי מחשבה", maze.Tagline);
        // the Stone Maze: the six upgraded puzzles, two doors
        Assert.Equal(["g1-pendulum", "g1-map", "g1-runes", "g1-cabinet", "g1-chest", "g1-door", "g2-levers", "g2-rails", "g2-gravity", "g2-gate"],
            maze.Puzzles.Select(p => p.Id).ToArray());
        Assert.All(maze.Puzzles, p => Assert.Contains(p.Type, UpgradedTypes));
        // the free game: exactly its live puzzles (the map, the symbols, the cabinet, the gears), none of the upgraded mechanisms
        Assert.Equal("PORTAL X — שער הסודות", free.Name);
        Assert.Equal(["g1-map", "g1-symbols", "g1-cabinet", "g2-gears"], free.Puzzles.Select(p => p.Id).ToArray());
        Assert.DoesNotContain(free.Puzzles, p => UpgradedTypes.Contains(p.Type));
        Assert.DoesNotContain(free.Puzzles, p => p.Id is "g1-pendulum" or "g1-runes" or "g2-levers" or "g2-rails" or "g2-gravity");
    }

    [Fact]
    public void The_whole_Stone_Maze_plays_from_the_first_room_to_the_exit_gate()
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("stone-maze", "MAZE23", "hash", T0);
        var ps = new List<PlayerSession>();
        for (var i = 0; i < 2; i++)
        {
            Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i], "{}", "m" + i, i == 0, T0, out var p).Ok);
            p!.IsConnected = true;
            ps.Add(p);
        }
        e.SetReady(r, ps[1].Id, true);
        Assert.True(e.StartGame(r, ps[0].Id, T0).Ok);
        Assert.True(e.FinishIntro(r, ps[0].Id, true, T0).Ok);
        var world = () => GameEngine.World(r);
        Assert.Equal(PuzzleStatus.Locked, r.Puzzles.First(p => p.PuzzleId == "g1-map").Status);
        StoneMazeRoom1Tests.PlayRoom1(e, r, ps, T0);
        Assert.Null(world().PendingZone);                       // the puzzles alone never open the next room
        StoneMazeDoorTests.ThroughTheStoneDoor(e, r, ps, T0);   // the door, with the ancient key, does
        Assert.Equal("gearworks", world().CurrentZone);
        Assert.NotEqual(RoomPhase.Completed, r.Phase);
        StoneMazeRoom2Tests.PlayRoom2(e, r, ps, T0);
        Assert.Equal(RoomPhase.Completed, r.Phase);
        Assert.True(world().Score!.Personal.Values.All(v => v > 0));
    }

    // ------------------------------------------------------------------ product, purchase, admin

    [Fact]
    public async Task The_site_sells_the_Stone_Maze_for_39_and_keeps_the_free_game_free()
    {
        var list = await _factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/products", Json);
        var byId = list.EnumerateArray().ToDictionary(p => p.GetProperty("id").GetString()!);
        var maze = byId["stone-maze"];
        Assert.Equal("מבוך האבן", maze.GetProperty("name").GetString());
        Assert.Equal("אתגר לחדי מחשבה", maze.GetProperty("tagline").GetString());
        Assert.Equal(39m, maze.GetProperty("price").GetDecimal());
        Assert.False(maze.GetProperty("isFree").GetBoolean());
        Assert.Equal("stone-maze", maze.GetProperty("scenarioId").GetString());
        Assert.True(maze.GetProperty("playable").GetBoolean());
        Assert.True(maze.GetProperty("purchasable").GetBoolean());
        var free = byId["gate-of-secrets"];
        Assert.True(free.GetProperty("isFree").GetBoolean());
        Assert.False(free.GetProperty("purchasable").GetBoolean());
        Assert.Equal("gate-of-secrets", free.GetProperty("scenarioId").GetString());
        Assert.Equal(90m, byId["hanukkah-oil"].GetProperty("price").GetDecimal());   // the other paid games keep their own
    }

    [Fact]
    public async Task Buying_the_Stone_Maze_charges_39_and_opens_a_Stone_Maze_game_only()
    {
        var http = _factory.CreateClient();
        var p = await CreateOrderAsync(http, _factory.Services, "stone-maze");
        // before the payment is approved, nothing opens
        Assert.False((await OpenGameAsync(http, p)).IsSuccessStatusCode);
        (await PayAsync(http, p)).EnsureSuccessStatusCode();
        var res = await OpenGameAsync(http, p);
        res.EnsureSuccessStatusCode();
        var code = (await res.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("code").GetString()!;
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        var order = await db.Orders.AsNoTracking().SingleAsync(o => o.Id == p.OrderId);
        Assert.Equal("stone-maze", order.ProductId);
        Assert.Equal(39m, order.PriceSnapshot);
        Assert.Equal("ILS", order.Currency);
        var room = await db.Rooms.AsNoTracking().SingleAsync(r => r.Code == code);
        Assert.Equal("stone-maze", room.ScenarioId);
        Assert.Equal("stone-maze", room.ProductId);
        // the same order never opens a second game, of this or of another product
        var again = await OpenGameAsync(http, p);
        var againCode = again.IsSuccessStatusCode ? (await again.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("code").GetString() : null;
        Assert.True(againCode == null || againCode == code);
        // the purchase grants one entitlement, for the Stone Maze only, and every game it opened is a Stone Maze game
        var ent = await db.Entitlements.AsNoTracking().SingleAsync(x => x.OrderId == p.OrderId);
        Assert.Equal("stone-maze", ent.ProductId);
        var opened = await db.Rooms.AsNoTracking().Where(r => r.EntitlementId == ent.Id).ToListAsync();
        Assert.Single(opened);
        Assert.All(opened, r => { Assert.Equal("stone-maze", r.ScenarioId); Assert.Equal("stone-maze", r.ProductId); });
    }

    [Fact]
    public async Task The_admin_lists_and_reports_the_Stone_Maze_like_the_other_paid_games()
    {
        var http = _factory.CreateClient();
        (await http.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        http.DefaultRequestHeaders.Add(AdminAuth.CsrfHeader, "1");
        // a paid Stone Maze game, so it shows in the orders and the revenue
        var p = await CreateOrderAsync(http, _factory.Services, "stone-maze");
        (await PayAsync(http, p)).EnsureSuccessStatusCode();
        (await OpenGameAsync(http, p)).EnsureSuccessStatusCode();

        var products = await http.GetFromJsonAsync<JsonElement>("/api/admin/products", Json);
        var row = products.EnumerateArray().Single(x => x.GetProperty("id").GetString() == "stone-maze");
        Assert.Equal("מבוך האבן", row.GetProperty("name").GetString());
        Assert.Equal(39m, row.GetProperty("price").ValueKind == JsonValueKind.Number ? row.GetProperty("price").GetDecimal() : row.GetProperty("priceIls").GetDecimal());

        var dash = await http.GetFromJsonAsync<JsonElement>("/api/admin/dashboard?includeTest=true", Json);
        var by = dash.GetProperty("byProduct").EnumerateArray().Single(x => x.GetProperty("productId").GetString() == "stone-maze");
        Assert.False(by.GetProperty("isFree").GetBoolean());
        Assert.True(by.GetProperty("money").GetProperty("gross").GetDecimal() >= 39m);
        Assert.True(by.GetProperty("games").GetInt32() >= 1);

        var orders = await http.GetFromJsonAsync<JsonElement>("/api/admin/orders?includeTest=true", Json);
        var rows = orders.ValueKind == JsonValueKind.Array ? orders : orders.GetProperty("rows");
        Assert.Contains(rows.EnumerateArray(), o => o.GetProperty("productId").GetString() == "stone-maze" && o.GetProperty("amount").GetDecimal() == 39m);

        var games = await http.GetFromJsonAsync<JsonElement>("/api/admin/games?includeTest=true", Json);
        Assert.Contains("stone-maze", games.GetRawText());
        var stats = await http.GetAsync("/api/admin/statistics?includeTest=true");
        Assert.Equal(HttpStatusCode.OK, stats.StatusCode);
        Assert.Contains("מבוך האבן", await stats.Content.ReadAsStringAsync());
    }
}
