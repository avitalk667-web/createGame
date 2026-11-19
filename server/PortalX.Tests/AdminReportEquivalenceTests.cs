using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Admin;
using PortalX.Server.Content;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;

namespace PortalX.Tests;

/// <summary>
/// The dashboard and the games table now count in SQL and no longer read the game state. These tests seed every kind
/// of order, room, result and player, then compare the new answers with the frozen old implementation
/// (<see cref="LegacyAdminReports"/>) on the same database, field by field, for many filters.
/// </summary>
[Collection(DatabaseCollection.Name)]
public class AdminReportEquivalenceTests(HubIntegrationTests.Factory factory)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    // A 10-day window far from the other tests' data and from earlier runs (the test database keeps its rows), so that
    // the period filters see only this run's rows and no two rooms share a creation time (the tables sort by it).
    private static readonly DateTime Start = new DateTime(1990, 1, 1, 8, 0, 0, DateTimeKind.Utc).AddDays(10 * Random.Shared.Next(0, 3000));
    private static readonly DateTime WindowEnd = Start.AddDays(9);

    private sealed record Seeded(string PaidA, string PaidB, string FreeId, string? FreeScenario, List<string> Codes);

    private static int _n;
    private static string Code() => "EQ" + Guid.NewGuid().ToString("N")[..10].ToUpperInvariant();

    /// <summary>Two paid games, the catalog's free game, and every combination the reports distinguish.</summary>
    private async Task<Seeded> SeedAsync()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        var tag = Interlocked.Increment(ref _n) + "-" + Guid.NewGuid().ToString("N")[..6];
        var t0 = Start.AddHours(_n * 3);
        var paidA = new Product { Id = "eqv-a-" + tag, Name = "בדיקת שקילות א", Status = ProductStatus.Draft, PriceIls = 149.90m, ScenarioId = "museum-heist", SortOrder = 900000, CreatedAt = t0, UpdatedAt = t0 };
        var paidB = new Product { Id = "eqv-b-" + tag, Name = "בדיקת שקילות ב", Status = ProductStatus.Draft, PriceIls = 99m, ScenarioId = "museum-heist", SortOrder = 900001, CreatedAt = t0, UpdatedAt = t0 };
        db.Products.AddRange(paidA, paidB);
        await db.SaveChangesAsync();
        // the dashboard's free report follows the first free product in the catalog (other tests seed it)
        var free = await db.Products.AsNoTracking().Where(p => p.IsFree).OrderBy(p => p.SortOrder).FirstOrDefaultAsync();
        var freeId = free?.Id ?? "free-sample-none";
        var codes = new List<string>();
        var minute = 0;
        DateTime T() => t0.AddMinutes(++minute);

        Order NewOrder(Product p, OrderStatus st, bool test, decimal price, decimal? refunded = null, string? email = null)
        {
            var at = T();
            var o = new Order
            {
                Id = Guid.NewGuid(), ProductId = p.Id, ProductName = p.Name, PriceSnapshot = price, Status = st, Provider = "sumit", IsTest = test,
                Email = email, AccessKeyHash = "x", CreatedAt = at, UpdatedAt = at,
                PaidAt = st is OrderStatus.Paid or OrderStatus.Refunded ? at : null,
                RefundedAt = st == OrderStatus.Refunded ? at : null, RefundedAmount = refunded,
            };
            db.Orders.Add(o);
            return o;
        }
        Entitlement Ent(Product p, Order? o, bool test, EntitlementSource src = EntitlementSource.Purchase)
        {
            var e = new Entitlement { Id = Guid.NewGuid(), ProductId = p.Id, OrderId = o?.Id, Source = src, IsTest = test, CreatedAt = T() };
            db.Entitlements.Add(e);
            return e;
        }
        GameRoom Room(string access, string? productId, string scenario, RoomPhase phase, Entitlement? ent = null, string world = "{}")
        {
            var at = T();
            var r = new GameRoom
            {
                Id = Guid.NewGuid(), Code = Code(), ScenarioId = scenario, Phase = phase, HostClaimHash = "x", CreatedAt = at, UpdatedAt = at,
                ProductId = productId, EntitlementId = ent?.Id, AccessSource = access, WorldJson = world,
                IntroStartedAt = phase == RoomPhase.Lobby ? null : at.AddSeconds(5),
                StartedAt = phase is RoomPhase.Playing or RoomPhase.Completed ? at.AddSeconds(30) : null,
                EndedAt = phase == RoomPhase.Completed ? at.AddMinutes(40) : null,
            };
            codes.Add(r.Code);
            db.Rooms.Add(r);
            return r;
        }
        void Players(GameRoom r, int active, int removed = 0)
        {
            for (var i = 0; i < active + removed; i++)
                db.Players.Add(new PlayerSession
                {
                    Id = Guid.NewGuid(), RoomId = r.Id, Nickname = "p" + i, CharacterId = "c", TokenHash = Guid.NewGuid().ToString("N"),
                    Seat = i, JoinedAt = r.CreatedAt.AddSeconds(i + 1), LastSeenAt = r.CreatedAt, IsRemoved = i >= active,
                });
        }
        void Result(GameRoom r, string completion, int minutesAfter, int duration = 1800) =>
            db.Results.Add(new GameResult
            {
                Id = Guid.NewGuid(), RoomId = r.Id, ScenarioId = r.ScenarioId, DurationSeconds = duration, PlayersCount = 2, HintsUsed = minutesAfter % 3,
                PuzzlesSolved = 7, PuzzlesTotal = 9, CompletionType = completion, CreatedAt = r.CreatedAt.AddMinutes(minutesAfter),
            });

        // ---- orders of every status, real and test, with and without e-mail (the same buyer in two spellings)
        var paid1 = NewOrder(paidA, OrderStatus.Paid, false, 149.90m, email: "Buyer@Example.com");
        var paid2 = NewOrder(paidA, OrderStatus.Paid, false, 134.91m, email: "buyer@example.com");
        var paidNoRoom = NewOrder(paidB, OrderStatus.Paid, false, 99m, email: "other@example.com");
        var refundedPart = NewOrder(paidA, OrderStatus.Refunded, false, 149.90m, refunded: 50.25m, email: "r@example.com");
        NewOrder(paidB, OrderStatus.Refunded, false, 99m); // refunded without an amount: the whole price
        NewOrder(paidA, OrderStatus.Pending, false, 149.90m);
        NewOrder(paidA, OrderStatus.Failed, false, 149.90m);
        NewOrder(paidB, OrderStatus.Cancelled, false, 99m);
        var testPaid = NewOrder(paidA, OrderStatus.Paid, true, 149.90m, email: "test@example.com");
        NewOrder(paidB, OrderStatus.Refunded, true, 99m, refunded: 99m);

        // ---- paid rooms: lobby, playing, completed, a lobby room with a result, a failed then successful run and the reverse
        var e1 = Ent(paidA, paid1, false);
        var lobby = Room("purchase", paidA.Id, "museum-heist", RoomPhase.Lobby, e1);
        Players(lobby, 1, 1);
        var e2 = Ent(paidA, paid2, false);
        var playing = Room("purchase", paidA.Id, "museum-heist", RoomPhase.Playing, e2, """{"score":{"group":120,"personal":{"a":40}}}""");
        Players(playing, 3, 2);
        Result(playing, "timeout", 10);
        Result(playing, "success", 20);
        var e3 = Ent(paidA, refundedPart, false);
        var done = Room("purchase", paidA.Id, "museum-heist", RoomPhase.Completed, e3, """{"score":{"personal":{}}}""");
        Players(done, 4);
        Result(done, "success", 5);
        Result(done, "timeout", 30);
        var eLobbyResult = Ent(paidB, null, false);
        var lobbyWithResult = Room("purchase", paidB.Id, "museum-heist", RoomPhase.Lobby, eLobbyResult, """{"score":null}""");
        Players(lobbyWithResult, 2);
        Result(lobbyWithResult, "timeout", 3);
        // a test purchase's room: left out unless test purchases are included
        var eTest = Ent(paidA, testPaid, true);
        var testRoom = Room("purchase", paidA.Id, "museum-heist", RoomPhase.Completed, eTest, """{"score":{"group":5}}""");
        Players(testRoom, 2);
        Result(testRoom, "success", 25);
        // an entitlement that points to no order, and a room whose entitlement does not exist
        Room("purchase", paidB.Id, "museum-heist", RoomPhase.Playing, Ent(paidB, null, false));
        var orphan = Room("purchase", paidB.Id, "museum-heist", RoomPhase.Lobby);
        orphan.EntitlementId = Guid.NewGuid();

        // ---- admin free games, treasure gifts, legacy and the old demo mode (also a test one)
        var adminFree = Room("admin-free", paidA.Id, "museum-heist", RoomPhase.Playing, Ent(paidA, null, false, EntitlementSource.AdminFree), """{"score":{"group":-15}}""");
        Players(adminFree, 2, 1);
        Room("admin-free", paidB.Id, "museum-heist", RoomPhase.Lobby, Ent(paidB, null, false, EntitlementSource.AdminFree));
        Room("treasure", paidB.Id, "museum-heist", RoomPhase.Completed, Ent(paidB, null, false, EntitlementSource.TreasureReward));
        Room("legacy", null, "museum-heist", RoomPhase.Completed);
        var demo = Room(RoomService.LegacyDemoAccess, paidA.Id, "museum-heist", RoomPhase.Completed, Ent(paidA, null, false, EntitlementSource.TestCheckout));
        Result(demo, "success", 9);
        Room(RoomService.LegacyDemoAccess, paidA.Id, "museum-heist", RoomPhase.Lobby, Ent(paidA, null, true, EntitlementSource.TestCheckout));

        // ---- the free trial: by product, by scenario only, started, completed, lobby, with players who left
        var freeScenario = free?.ScenarioId;
        var s1 = Room("free-sample", freeId, freeScenario ?? "museum-heist", RoomPhase.Completed, world: """{"score":{"group":300}}""");
        Players(s1, 2, 1);
        Result(s1, "success", 15);
        var s2 = Room("free-sample", freeId, freeScenario ?? "museum-heist", RoomPhase.Lobby);
        Players(s2, 0, 2);
        var s3 = Room("free-sample", null, freeScenario ?? "museum-heist", RoomPhase.Playing);
        Players(s3, 1);
        var s4 = Room("free-sample", freeId, freeScenario ?? "museum-heist", RoomPhase.Intro);
        Players(s4, 3);
        Result(s4, "timeout", 12);

        await db.SaveChangesAsync();
        _ = paidNoRoom;
        return new Seeded(paidA.Id, paidB.Id, freeId, freeScenario, codes);
    }

    private async Task<(string Old, string New)> CompareAsync(Func<LegacyAdminReports, Task<object>> legacy, Func<AdminService, Task<object>> current)
    {
        using var scope = factory.Services.CreateScope();
        var sp = scope.ServiceProvider;
        var old = await legacy(new LegacyAdminReports(sp.GetRequiredService<PortalDbContext>(), sp.GetRequiredService<ScenarioCatalog>()));
        var now = await current(sp.GetRequiredService<AdminService>());
        return (JsonSerializer.Serialize(old, Json), JsonSerializer.Serialize(now, Json));
    }

    private static AdminFilter Filter(DateTime? from = null, DateTime? to = null, string? product = null, string? access = null,
        string? search = null, bool test = false) => new(from, to, product, null, access, search, test);

    public static IEnumerable<object[]> Cases() => Enumerable.Range(0, 9).Select(i => new object[] { i });

    private static AdminFilter Case(int i, Seeded s)
    {
        var from = Start;
        var to = WindowEnd;
        return i switch
        {
            0 => Filter(),                                  // all time, the default
            1 => Filter(test: true),                        // with test purchases
            2 => Filter(from, to),                          // the seeded period only
            3 => Filter(from, to, test: true),
            4 => Filter(from, to, product: s.PaidA),
            5 => Filter(from, to, product: s.PaidB, test: true),
            6 => Filter(product: s.FreeId),
            7 => Filter(from: DateTime.UtcNow.AddDays(-30)),  // the other tests' recent data
            _ => Filter(from: new DateTime(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc), to: new DateTime(2000, 2, 1, 0, 0, 0, DateTimeKind.Utc)), // nothing at all
        };
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task The_dashboard_counts_in_sql_exactly_what_it_counted_before(int i)
    {
        var s = await SeedAsync();
        var f = Case(i, s);
        var (old, now) = await CompareAsync(l => l.DashboardAsync(f), a => a.DashboardAsync(f));
        Assert.Equal(old, now);
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task The_games_table_shows_exactly_what_it_showed_before(int i)
    {
        var s = await SeedAsync();
        var f = Case(i, s);
        var (old, now) = await CompareAsync(l => l.GamesAsync(f), a => a.GamesAsync(f));
        Assert.Equal(old, now);
    }

    [Theory]
    [InlineData("purchase")]
    [InlineData("admin-free")]
    [InlineData("free-sample")]
    [InlineData("treasure")]
    [InlineData("legacy")]
    [InlineData(RoomService.LegacyDemoAccess)]
    public async Task Every_access_filter_of_the_games_table_is_unchanged(string access)
    {
        var s = await SeedAsync();
        foreach (var test in new[] { false, true })
        {
            var f = Filter(Start, WindowEnd, access: access, test: test);
            var (old, now) = await CompareAsync(l => l.GamesAsync(f), a => a.GamesAsync(f));
            Assert.Equal(old, now);
        }
    }

    [Fact]
    public async Task Searching_one_game_code_and_reading_its_group_score_are_unchanged()
    {
        var s = await SeedAsync();
        foreach (var code in s.Codes)
            foreach (var test in new[] { false, true })
            {
                var f = Filter(search: code.ToLowerInvariant(), test: test);
                var (old, now) = await CompareAsync(l => l.GamesAsync(f), a => a.GamesAsync(f));
                Assert.Equal(old, now);
            }
    }

    [Fact]
    public async Task The_seeded_rows_really_cover_the_cases_the_reports_tell_apart()
    {
        var s = await SeedAsync();
        using var scope = factory.Services.CreateScope();
        var admin = scope.ServiceProvider.GetRequiredService<AdminService>();
        var f = Filter(Start, WindowEnd, product: s.PaidA, test: true);
        using var games = JsonDocument.Parse(JsonSerializer.Serialize(await admin.GamesAsync(f), Json));
        var rows = games.RootElement.EnumerateArray().ToList();
        // scores: a number, a negative number, none, and an absent "group" (0)
        Assert.Contains(rows, r => r.GetProperty("groupScore").ValueKind == JsonValueKind.Number && r.GetProperty("groupScore").GetInt32() == 120);
        Assert.Contains(rows, r => r.GetProperty("groupScore").ValueKind == JsonValueKind.Number && r.GetProperty("groupScore").GetInt32() == -15);
        Assert.Contains(rows, r => r.GetProperty("groupScore").ValueKind == JsonValueKind.Number && r.GetProperty("groupScore").GetInt32() == 0);
        Assert.Contains(rows, r => r.GetProperty("groupScore").ValueKind == JsonValueKind.Null);
        // the latest result decides: success after a timeout is completed, a timeout after a success keeps the phase's word
        Assert.Contains(rows, r => r.GetProperty("phase").GetString() == "playing" && r.GetProperty("status").GetString() == "completed");
        Assert.Contains(rows, r => r.GetProperty("isTest").GetBoolean());
        Assert.Contains(rows, r => r.GetProperty("orderNumber").ValueKind == JsonValueKind.Number);

        var d = JsonDocument.Parse(JsonSerializer.Serialize(await admin.DashboardAsync(Filter(Start, WindowEnd)), Json)).RootElement;
        Assert.True(d.GetProperty("revenue").GetProperty("gross").GetDecimal() > 0);
        Assert.True(d.GetProperty("revenue").GetProperty("refunds").GetDecimal() > 0);
        Assert.True(d.GetProperty("games").GetProperty("purchasedNotStarted").GetInt32() > 0);
        Assert.True(d.GetProperty("games").GetProperty("demo").GetInt32() > 0);
    }
}
