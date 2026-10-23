using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Admin;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using PortalX.Server.Payments;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>Extensions spec, section 7: the 4-player limit, the free trial game, the FAQ and discount coupons.</summary>
[Collection(DatabaseCollection.Name)]
public class ExtensionsTests
{
    private const string FullMessage = "המשחק מלא. אפשר להצטרף לאחר שמתפנה מקום.";
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HubIntegrationTests.Factory _factory;

    public ExtensionsTests(HubIntegrationTests.Factory factory) => _factory = factory;

    private async Task<HttpClient> AdminAsync()
    {
        var http = _factory.CreateClient();
        (await http.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        http.DefaultRequestHeaders.Add(AdminAuth.CsrfHeader, "1");
        return http;
    }

    private async Task<T> DbAsync<T>(Func<PortalDbContext, Task<T>> f)
    {
        using var scope = _factory.Services.CreateScope();
        return await f(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
    }

    private static async Task<JsonElement> Body(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>(Json);

    private static string Unique(string prefix) => prefix + Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();

    // ------------------------------------------------------------------ 4 participants

    [Theory]
    [InlineData("last-portal")]
    [InlineData("hanukkah-oil")]
    [InlineData("gate-of-secrets")]
    public void Every_game_takes_four_participants_including_the_host_and_refuses_a_fifth(string scenario)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom(scenario, "FOUR23", "hash", T0);
        Assert.Equal(4, e.MaxPlayers(r));
        for (var i = 0; i < 4; i++)
            Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i], "{}", "t" + i, i == 0, T0, out _).Ok);
        var fifth = e.AddPlayer(r, "חמישי", GameEngine.Characters[0], "{}", "t5", false, T0, out var p5);
        Assert.False(fifth.Ok);
        Assert.Equal("room-full", fifth.Code);
        Assert.Equal(FullMessage, fifth.Message);
        Assert.Null(p5);
        Assert.Equal(4, r.Players.Count);
    }

    [Fact]
    public void A_game_opened_before_the_change_keeps_its_players_but_takes_nobody_beyond_four()
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("hanukkah-oil", "OLD823", "hash", T0);
        r.MaxPlayers = 8; // as stored before the migration capped it
        for (var i = 0; i < 4; i++) Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i], "{}", "t" + i, i == 0, T0, out _).Ok);
        Assert.Equal(4, e.MaxPlayers(r));
        Assert.Equal(FullMessage, e.AddPlayer(r, "חמישי", GameEngine.Characters[0], "{}", "t5", false, T0, out _).Message);
    }

    [Fact]
    public async Task Players_joining_at_the_same_moment_never_exceed_four()
    {
        var http = _factory.CreateClient();
        var game = await Body(await http.PostAsync("/api/products/gate-of-secrets/free-game", null));
        var code = game.GetProperty("code").GetString()!;
        var joins = Enumerable.Range(0, 9).Select(i => _factory.CreateClient().PostAsJsonAsync($"/api/rooms/{code}/players",
            new { nickname = "שחקן" + i, characterId = GameEngine.Characters[i % 4], appearance = "{}" })).ToList();
        var results = await Task.WhenAll(joins);
        Assert.Equal(4, results.Count(r => r.StatusCode == HttpStatusCode.OK));
        foreach (var refused in results.Where(r => r.StatusCode != HttpStatusCode.OK))
            Assert.Equal(FullMessage, (await Body(refused)).GetProperty("message").GetString());
        var stored = await DbAsync(db => db.Players.CountAsync(p => db.Rooms.Any(r => r.Code == code && r.Id == p.RoomId)));
        Assert.Equal(4, stored);
        var info = await Body(await http.GetAsync($"/api/rooms/{code}"));
        Assert.Equal(4, info.GetProperty("maxPlayers").GetInt32());
        Assert.False(info.GetProperty("canJoin").GetBoolean());
    }

    // ------------------------------------------------------------------ the free trial game

    [Fact]
    public async Task The_free_game_opens_without_payment_and_is_never_revenue()
    {
        var http = _factory.CreateClient();
        var products = await Body(await http.GetAsync("/api/products"));
        var free = products.EnumerateArray().First(p => p.GetProperty("id").GetString() == "gate-of-secrets");
        Assert.True(free.GetProperty("isFree").GetBoolean());
        Assert.False(free.GetProperty("purchasable").GetBoolean());

        var before = await DbAsync(db => db.Orders.CountAsync());
        var res = await http.PostAsync("/api/products/gate-of-secrets/free-game", null);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var code = (await Body(res)).GetProperty("code").GetString()!;
        var room = await DbAsync(db => db.Rooms.AsNoTracking().FirstAsync(r => r.Code == code));
        Assert.Equal("free-sample", room.AccessSource);
        Assert.Null(room.EntitlementId);
        Assert.Equal(before, await DbAsync(db => db.Orders.CountAsync()));

        // a paid game cannot be opened through the free path, and the free game cannot be bought
        Assert.Equal(HttpStatusCode.Forbidden, (await http.PostAsync("/api/products/hanukkah-oil/free-game", null)).StatusCode);
        var buy = await http.PostAsJsonAsync("/api/orders", new { productId = "gate-of-secrets" });
        Assert.False(buy.IsSuccessStatusCode);
    }

    [Fact]
    public void The_free_game_has_exactly_two_rooms_and_every_puzzle_is_solvable()
    {
        var c = Catalog.Get("gate-of-secrets");
        Assert.Equal(["maproom", "gearworks"], c.Zones.Select(z => z.Id).ToArray());
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("gate-of-secrets", "GATE23", "hash", T0);
        var ps = new List<PlayerSession>();
        for (var i = 0; i < 2; i++)
        {
            Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i], "{}", "g" + i, i == 0, T0, out var p).Ok);
            p!.IsConnected = true;
            ps.Add(p);
        }
        e.SetReady(r, ps[1].Id, true);
        Assert.True(e.StartGame(r, ps[0].Id, T0).Ok);
        Assert.True(e.FinishIntro(r, ps[0].Id, true, T0).Ok);
        ActionOutcome Op(int who, string puzzle, object action) => e.Operate(r, ps[who].Id, puzzle, J(action), T0);
        var world = () => GameEngine.World(r);

        // room 1: the middle map piece appears only after the note by the drawers is read
        Assert.DoesNotContain("map-middle", world().WorldItems);
        Assert.True(e.DiscoverClue(r, ps[1].Id, "g1-note", T0).Ok);
        Assert.Contains("map-middle", world().WorldItems);
        foreach (var item in new[] { "map-left", "map-middle", "map-right", "sym-compass", "sym-key", "sym-book", "sym-lamp" })
            Assert.True(e.PickUp(r, ps[0].Id, item, T0).Ok, item);
        Assert.Equal("wrong-place", Op(1, "g1-map", new { op = "place", slot = "m1", item = "map-right" }).Code);
        Assert.True(Op(1, "g1-map", new { op = "place", slot = "m1", item = "map-left" }).Ok);
        Assert.True(Op(0, "g1-map", new { op = "place", slot = "m2", item = "map-middle" }).Ok);
        Assert.Equal("solved", Op(0, "g1-map", new { op = "place", slot = "m3", item = "map-right" }).Code);
        Assert.Contains("התחילו במה שמראה כיוון", c.Puzzle("g1-map").Success);

        Assert.Equal("הלוח עדיין לא מלא. הניחו את כל ארבעת הסמלים במקומות.", Op(0, "g1-symbols", new { op = "activate" }).Message);
        Op(0, "g1-symbols", new { op = "place", slot = "s1", item = "sym-key" });
        Op(0, "g1-symbols", new { op = "place", slot = "s2", item = "sym-compass" });
        Op(0, "g1-symbols", new { op = "place", slot = "s3", item = "sym-book" });
        Assert.Equal("placed-wrong", Op(0, "g1-symbols", new { op = "place", slot = "s4", item = "sym-lamp" }).Code);
        Assert.False(e.SubmitAnswer(r, ps[0].Id, "g1-cabinet", J("3142"), T0).Ok); // still locked
        Op(1, "g1-symbols", new { op = "reset" });
        Op(1, "g1-symbols", new { op = "place", slot = "s1", item = "sym-compass" });
        Op(1, "g1-symbols", new { op = "place", slot = "s2", item = "sym-key" });
        Op(1, "g1-symbols", new { op = "place", slot = "s3", item = "sym-book" });
        Assert.Equal("solved", Op(1, "g1-symbols", new { op = "place", slot = "s4", item = "sym-lamp" }).Code);
        var backs = world().Mechanisms["g1-symbols"].Backs;
        Assert.Equal("3142", backs["s1"] + backs["s2"] + backs["s3"] + backs["s4"]);
        Assert.Equal("wrong", e.SubmitAnswer(r, ps[0].Id, "g1-cabinet", J("1234"), T0).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[0].Id, "g1-cabinet", J("3142"), T0).Code);
        Assert.Contains("gs-golden-key", world().Inventory);
        Assert.Equal("gearworks", world().PendingZone);
        Assert.True(e.Continue(r, ps[0].Id, T0).Ok);

        // room 2: gears by the diagram (wrong axle refused), the lever, then the two mirrors
        foreach (var gear in new[] { "gear-large", "gear-small", "gear-medium" }) Assert.True(e.PickUp(r, ps[1].Id, gear, T0).Ok);
        Assert.Equal("wrong-place", Op(0, "g2-gears", new { op = "place", slot = "a1", item = "gear-small" }).Code);
        Op(0, "g2-gears", new { op = "place", slot = "a1", item = "gear-large" });
        Op(0, "g2-gears", new { op = "place", slot = "a2", item = "gear-small" });
        Op(1, "g2-gears", new { op = "place", slot = "a3", item = "gear-medium" });
        Assert.Equal(PuzzleStatus.Active, r.Puzzles.First(p => p.PuzzleId == "g2-gears").Status); // waits for the lever
        Assert.Equal("solved", Op(1, "g2-gears", new { op = "activate" }).Code);

        // mirror 1 from 2 to 6, mirror 2 from 3 to 5 (one step back)
        for (var k = 0; k < 4; k++) Assert.Equal("rotated", Op(k % 2, "g2-mirrors", new { op = "rotate", index = 0 }).Code);
        Assert.Equal(RoomPhase.Playing, r.Phase);
        Assert.Equal("rotated", Op(0, "g2-mirrors", new { op = "rotate", index = 1 }).Code);          // 4
        Assert.Equal("rotated", Op(0, "g2-mirrors", new { op = "rotate", index = 1, dir = -1 }).Code); // back to 3
        Assert.Equal("rotated", Op(1, "g2-mirrors", new { op = "rotate", index = 1 }).Code);          // 4
        Assert.Equal("solved", Op(1, "g2-mirrors", new { op = "rotate", index = 1 }).Code);           // 5
        Assert.Equal(RoomPhase.Completed, r.Phase);
        Assert.True(world().Score!.Personal.Values.All(v => v > 0));
    }

    // ------------------------------------------------------------------ FAQ

    [Fact]
    public async Task The_home_page_FAQ_keeps_the_built_in_questions_and_shows_published_admin_questions()
    {
        var http = _factory.CreateClient();
        var list = (await Body(await http.GetAsync("/api/faq"))).EnumerateArray().ToList();
        Assert.True(list.Count >= 10);
        Assert.Equal("מהו PORTAL X?", list[0].GetProperty("question").GetString());
        Assert.Equal("בכל משחק יכולים להשתתף עד 4 שחקנים, כולל המארח.", list[1].GetProperty("answer").GetString());
        Assert.All(list.Take(10), q => Assert.True(q.GetProperty("isFixed").GetBoolean()));

        // a visitor cannot add questions
        Assert.Equal(HttpStatusCode.Unauthorized, (await http.PostAsJsonAsync("/api/admin/faq", new { question = "שאלה?", answer = "תשובה" })).StatusCode);

        var admin = await AdminAsync();
        var q = Unique("האם יש הנחה לקבוצות? ");
        var created = await Body(await admin.PostAsJsonAsync("/api/admin/faq", new { question = q, answer = "<b>כן</b> <script>alert(1)</script>", published = true }));
        var id = created.GetProperty("id").GetString();
        var shown = (await Body(await http.GetAsync("/api/faq"))).EnumerateArray().First(x => x.GetProperty("id").GetString() == id);
        Assert.False(shown.GetProperty("isFixed").GetBoolean());
        // stored and served as plain text; the page shows it as text, never as markup
        Assert.Equal("<b>כן</b> <script>alert(1)</script>", shown.GetProperty("answer").GetString());

        (await admin.PutAsJsonAsync($"/api/admin/faq/{id}", new { published = false })).EnsureSuccessStatusCode();
        Assert.DoesNotContain((await Body(await http.GetAsync("/api/faq"))).EnumerateArray(), x => x.GetProperty("id").GetString() == id);
        (await admin.DeleteAsync($"/api/admin/faq/{id}")).EnsureSuccessStatusCode();
        Assert.Equal(10, (await Body(await http.GetAsync("/api/faq"))).EnumerateArray().Count(x => x.GetProperty("isFixed").GetBoolean()));
    }

    // ------------------------------------------------------------------ coupons

    private async Task<string> CreateCouponAsync(HttpClient admin, string kind, decimal value, string product, DateTime? starts = null, DateTime? ends = null, int? max = null, bool active = true)
    {
        var code = Unique("T");
        var res = await admin.PostAsJsonAsync("/api/admin/coupons", new
        {
            code, name = "בדיקה", kind, value, productIds = new[] { product }, startsAt = starts, endsAt = ends, maxRedemptions = max, active,
        });
        Assert.True(res.IsSuccessStatusCode, await res.Content.ReadAsStringAsync());
        return code;
    }

    private Task<HttpResponseMessage> Check(HttpClient http, string product, string code) =>
        http.PostAsJsonAsync("/api/coupons/check", new { productId = product, code });

    [Fact]
    public void Coupon_prices_are_computed_on_the_server_and_never_drop_below_the_minimum()
    {
        Assert.Equal((13.50m, 76.50m), CouponService.Price(90m, CouponKind.Percent, 15m));
        Assert.Equal((10m, 80m), CouponService.Price(90m, CouponKind.Fixed, 10m));
        Assert.Equal((89m, 1m), CouponService.Price(90m, CouponKind.Fixed, 500m));
        Assert.Equal((7.50m, 42.50m), CouponService.Price(50m, CouponKind.Percent, 15m));
    }

    [Fact]
    public async Task A_coupon_applies_only_to_its_product_and_the_order_stores_the_discount()
    {
        await TestPurchase.EnsureProductAsync(_factory.Services);
        var admin = await AdminAsync();
        var http = _factory.CreateClient();
        var percent = await CreateCouponAsync(admin, "percent", 15m, TestPurchase.ProductId);
        var fixedCode = await CreateCouponAsync(admin, "fixed", 10m, TestPurchase.ProductId);

        var quote = await Body(await Check(http, TestPurchase.ProductId, percent.ToLowerInvariant()));
        Assert.Equal(50m, quote.GetProperty("originalPrice").GetDecimal());
        Assert.Equal(7.50m, quote.GetProperty("discount").GetDecimal());
        Assert.Equal(42.50m, quote.GetProperty("finalPrice").GetDecimal());
        Assert.Equal(40m, (await Body(await Check(http, TestPurchase.ProductId, fixedCode))).GetProperty("finalPrice").GetDecimal());

        // another game: the exact message of the spec
        var wrong = await Check(http, "hanukkah-oil", percent);
        Assert.Equal(CouponService.WrongProductMessage, (await Body(wrong)).GetProperty("message").GetString());

        // the browser may send any price: the order is priced by the server
        var res = await http.PostAsJsonAsync("/api/orders", new { productId = TestPurchase.ProductId, couponCode = percent, price = 1, finalPrice = 1 });
        Assert.True(res.IsSuccessStatusCode, await res.Content.ReadAsStringAsync());
        var o = await Body(res);
        Assert.Equal(42.50m, o.GetProperty("price").GetDecimal());
        var orderId = o.GetProperty("orderId").GetGuid();
        var stored = await DbAsync(db => db.Orders.AsNoTracking().FirstAsync(x => x.Id == orderId));
        Assert.Equal(50m, stored.OriginalPrice);
        Assert.Equal(7.50m, stored.DiscountAmount);
        Assert.Equal(42.50m, stored.PriceSnapshot);
        Assert.Equal(percent, stored.CouponCode);

        // paying redeems the use; the admin report shows it
        var url = o.GetProperty("checkoutUrl").GetString()!;
        (await http.PostAsJsonAsync($"/api/sandbox/checkout/{url[(url.LastIndexOf('/') + 1)..]}", new { outcome = "approve" })).EnsureSuccessStatusCode();
        var report = (await Body(await admin.GetAsync("/api/admin/coupons"))).EnumerateArray().First(c => c.GetProperty("code").GetString() == percent);
        Assert.Equal(1, report.GetProperty("redeemed").GetInt32());
        Assert.Equal(7.50m, report.GetProperty("discountGiven").GetDecimal());
    }

    [Fact]
    public async Task Expired_disabled_and_unknown_coupons_are_refused_with_clear_messages()
    {
        await TestPurchase.EnsureProductAsync(_factory.Services);
        var admin = await AdminAsync();
        var http = _factory.CreateClient();
        var expired = await CreateCouponAsync(admin, "percent", 10m, TestPurchase.ProductId, DateTime.UtcNow.AddDays(-10), DateTime.UtcNow.AddDays(-1));
        var disabled = await CreateCouponAsync(admin, "percent", 10m, TestPurchase.ProductId, active: false);
        Assert.Equal(CouponService.ExpiredMessage, (await Body(await Check(http, TestPurchase.ProductId, expired))).GetProperty("message").GetString());
        Assert.Equal(CouponService.UnknownMessage, (await Body(await Check(http, TestPurchase.ProductId, disabled))).GetProperty("message").GetString());
        Assert.Equal(CouponService.UnknownMessage, (await Body(await Check(http, TestPurchase.ProductId, "NOSUCHCODE1"))).GetProperty("message").GetString());
        // an order with a refused coupon is not created at all
        Assert.False((await http.PostAsJsonAsync("/api/orders", new { productId = TestPurchase.ProductId, couponCode = expired })).IsSuccessStatusCode);
        // visitors cannot create or list coupons
        var visitor = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await visitor.GetAsync("/api/admin/coupons")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await visitor.PostAsJsonAsync("/api/admin/coupons", new { code = "HACK123" })).StatusCode);
    }

    [Fact]
    public async Task The_last_use_of_a_coupon_cannot_be_taken_twice_and_a_failed_payment_gives_it_back()
    {
        await TestPurchase.EnsureProductAsync(_factory.Services);
        var admin = await AdminAsync();
        var code = await CreateCouponAsync(admin, "fixed", 5m, TestPurchase.ProductId, max: 1);
        var buys = Enumerable.Range(0, 6).Select(_ => _factory.CreateClient()
            .PostAsJsonAsync("/api/orders", new { productId = TestPurchase.ProductId, couponCode = code })).ToList();
        var results = await Task.WhenAll(buys);
        var ok = results.Where(r => r.IsSuccessStatusCode).ToList();
        Assert.Single(ok);
        foreach (var refused in results.Where(r => !r.IsSuccessStatusCode))
            Assert.Equal(CouponService.UsedUpMessage, (await Body(refused)).GetProperty("message").GetString());

        // the payment fails: the reserved use returns, and the next buyer can use the coupon
        var url = (await Body(ok[0])).GetProperty("checkoutUrl").GetString()!;
        var http = _factory.CreateClient();
        (await http.PostAsJsonAsync($"/api/sandbox/checkout/{url[(url.LastIndexOf('/') + 1)..]}", new { outcome = "decline" })).EnsureSuccessStatusCode();
        Assert.True((await http.PostAsJsonAsync("/api/orders", new { productId = TestPurchase.ProductId, couponCode = code })).IsSuccessStatusCode);
    }
}
