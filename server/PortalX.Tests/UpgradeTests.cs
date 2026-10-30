using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Admin;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using PortalX.Server.Mail;
using PortalX.Server.Referrals;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>The "friend brings a friend" campaign, the results-email ranking, the original game's personal score and hints.</summary>
public class UpgradeTests
{
    private static readonly DateTime T0 = new(2026, 11, 2, 18, 0, 0, DateTimeKind.Utc);

    private static Order Paid(string? email, Action<Order>? change = null)
    {
        var o = new Order
        {
            Id = Guid.NewGuid(), ReferralLinkId = Guid.NewGuid(), Status = OrderStatus.Paid, PaidAt = T0, Email = email, PriceSnapshot = 90,
        };
        change?.Invoke(o);
        return o;
    }

    [Fact]
    public void The_draw_counts_different_real_buyers_only()
    {
        Assert.Equal(4, CampaignContent.QualifyingBuyers([Paid("a@x.test"), Paid("b@x.test"), Paid("c@x.test"), Paid("d@x.test")]));
        // the same buyer twice (any letter case) counts once
        Assert.Equal(1, CampaignContent.QualifyingBuyers([Paid("a@x.test"), Paid("A@X.test")]));
        // test payments, refunds, failed, cancelled, unpaid orders and the owner's own purchase never count
        Assert.Equal(0, CampaignContent.QualifyingBuyers([
            Paid("t@x.test", o => o.IsTest = true),
            Paid("r@x.test", o => o.Status = OrderStatus.Refunded),
            Paid("f@x.test", o => { o.Status = OrderStatus.Failed; o.PaidAt = null; }),
            Paid("c@x.test", o => { o.Status = OrderStatus.Cancelled; o.PaidAt = null; }),
            Paid("p@x.test", o => { o.Status = OrderStatus.Pending; o.PaidAt = null; }),
            Paid("owner@x.test", o => o.ReferralExclusion = "self-purchase"),
        ]));
        Assert.Equal(2, CampaignContent.QualifyingBuyers([Paid(null), Paid(null)]));
    }

    private static CampaignContent Campaign => new()
    {
        Enabled = true, Title = "חבר מביא חבר — ואולי זוכים ב־888 ₪!", Prize = "888 ₪", Lead = "יש לכם קישור אישי ל-PORTAL X?", Body = "גוף", DrawLabel = "תאריך ההגרלה",
        DrawDate = "יום ראשון, ג׳ בטבת תשפ״ז — 13/12/2026", ButtonLabel = "לקישור האישי שלי", MinBuyers = 4,
    };

    [Fact]
    public void The_shipped_campaign_texts_are_the_requested_ones()
    {
        // shipped switched off until the draw rules are approved; the texts are ready
        var c = CampaignContent.LoadDefault();
        Assert.Equal("חבר מביא חבר — ואולי זוכים ב־888 ₪!", c.Title);
        Assert.Equal("יום ראשון, ג׳ בטבת תשפ״ז — 13/12/2026", c.DrawDate);
        Assert.Equal("לקישור האישי שלי", c.ButtonLabel);
        Assert.Equal(4, c.MinBuyers);
        Assert.Equal("חברים מביאים חברים — ואולי זוכים ב־888 ₪!", c.PopupTitle);
    }

    [Fact]
    public void The_results_email_has_the_full_ranking_and_the_campaign_banner()
    {
        var team = new List<TeamScore> { new("אבי", 125, 1, false), new("<b>דודי</b>", 90, 2, true), new("יוסי", 90, 2, false), new("משה", 40, 4, false) };
        var model = new ResultsEmailModel("סוד פך השמן", T0, "<b>דודי</b>", 90, 2, false, team, 340, 1265, 11, 11, 4, [],
            "https://portalx.test", "info.portalx@gmail.com", null, Campaign);
        var html = ResultsEmailTemplate.Html(model);
        Assert.Contains("דירוג המשתתפים", html);
        Assert.Contains("כינוי המשתתף", html);
        Assert.Contains("ניקוד אישי", html);
        Assert.Contains("#fbe7a8", html); // first place in gold
        foreach (var p in new[] { "אבי", "יוסי", "משה" }) Assert.Contains(p, html);
        Assert.DoesNotContain("<b>דודי</b>", html);
        Assert.DoesNotContain("@x.test", html);
        // the banner: no script, no images, the button to the personal-link page, at most 600px
        Assert.Contains("888 ₪", html);
        Assert.Contains("https://portalx.test/share", html);
        Assert.Contains("max-width:600px", html);
        Assert.DoesNotContain("<script", html);
        Assert.DoesNotContain("<img", html);
        var text = ResultsEmailTemplate.Text(model);
        Assert.Contains("1. אבי — 125", text);
        Assert.Contains("4. משה — 40", text);
        Assert.Contains("13/12/2026", text);
        Assert.Contains("https://portalx.test/share", text);
        // a single player still sees the ranking row of their own
        var alone = ResultsEmailTemplate.Html(model with { Team = [new TeamScore("אבי", 125, 1, true)], PersonalRank = 1 });
        Assert.Contains("דירוג המשתתפים", alone);
    }

    [Fact]
    public void The_personal_link_email_carries_the_campaign_banner()
    {
        var m = new ReferralEmailModel("שרה", "https://portalx.test/r/abc", "https://portalx.test", "info.portalx@gmail.com", null, Campaign);
        Assert.Contains("888 ₪", ReferralEmailTemplate.Html(m));
        Assert.Contains("לקישור האישי שלי", ReferralEmailTemplate.Html(m));
        Assert.Contains("13/12/2026", ReferralEmailTemplate.Text(m));
        Assert.DoesNotContain("888", ReferralEmailTemplate.Html(m with { Campaign = null }));
    }

    // ------------------------------------------------------------------ the original game ("הפורטל האחרון")

    [Fact]
    public void The_last_portal_scores_each_player_for_what_they_did()
    {
        var (e, r, ps) = Setup(2);
        StartPlaying(e, r, ps);
        int Mine(PlayerSession p) => GameEngine.World(r).Score!.Personal.GetValueOrDefault(p.Id.ToString());
        Assert.True(e.PickUp(r, ps[1].Id, "handle", T0).Ok);
        Assert.Equal(10, Mine(ps[1]));
        Assert.Equal("solved", e.SubmitAnswer(r, ps[0].Id, "p1-cipher", J("שער"), T0).Code);
        Assert.Equal(25, Mine(ps[0]));
        Assert.Equal(10, Mine(ps[1])); // the other player's score does not change
        Assert.Equal(100, GameEngine.World(r).Score!.Group); // the room's group points
        Assert.Equal("already-solved", e.SubmitAnswer(r, ps[1].Id, "p1-cipher", J("שער"), T0).Code);
        Assert.Equal(1, GameEngine.World(r).Score!.Log.Count(l => l.Key == "answer:p1-cipher"));
        var ranking = GameEngine.Ranking(r, GameEngine.World(r));
        Assert.Equal(ps[0].Id, ranking[0].Player.Id);
        Assert.Equal(1, ranking[0].Rank);
        var snap = Snapshots.Build(e, r, null, T0);
        Assert.NotNull(snap.Score);
        Assert.Equal(2, snap.Score!.Players.Count);
    }

    [Fact]
    public void The_last_portal_hints_never_give_away_an_answer()
    {
        foreach (var p in Catalog.Get("last-portal").Puzzles)
        {
            var answers = new List<string>();
            if (p.Solution["text"] is { } t) answers.Add(t.GetValue<string>());
            if (p.Solution["sequence"] is System.Text.Json.Nodes.JsonArray seq) answers.Add(string.Join(" ", seq.Select(n => n!.GetValue<string>())));
            Assert.InRange(p.Hints.Count, 1, 3);
            foreach (var hint in p.Hints)
                foreach (var a in answers)
                    Assert.DoesNotContain(GameEngine.NormalizeText(a), GameEngine.NormalizeText(hint));
            Assert.DoesNotContain(p.Hints, h => h.Contains("כוח שמחזיק") || h.Contains("משהו גדול שעוברים דרכו"));
        }
    }

    // ------------------------------------------------------------------ admin game questions (engine)

    [Fact]
    public void An_admin_question_is_fixed_when_the_game_starts_and_checked_on_the_server()
    {
        var engine = new GameEngine(Catalog, new GameOptions());
        var room = engine.CreateRoom("hanukkah-oil", "QST234", "hash", T0);
        Assert.True(engine.AddPlayer(room, "אבי", "explorer", "{}", "t0", true, T0, out var p).Ok);
        p!.IsConnected = true;
        Assert.True(engine.StartGame(room, p.Id, T0).Ok);
        var q = new GameQuestion
        {
            Id = Guid.NewGuid(), ScenarioId = "hanukkah-oil", PuzzleId = "h1-riddle", Question = "מה מסובבים בחנוכה?", Answer = "סביבון",
            AcceptJson = "[\"סביבונים\"]", Points = 40, Active = true, Version = 3, Difficulty = "קלה",
        };
        engine.UseQuestions(room, [q, new GameQuestion { Id = Guid.NewGuid(), ScenarioId = "hanukkah-oil", PuzzleId = "h1-riddle", Question = "כבויה", Answer = "x", Active = false, AcceptJson = "[]" }], T0);
        Assert.True(engine.FinishIntro(room, p.Id, true, T0).Ok);

        // the players see the new question and the right option among the buttons — never the answer as such
        var snap = Snapshots.Build(engine, room, null, T0);
        var patch = snap.Questions!["h1-riddle"];
        Assert.Equal("מה מסובבים בחנוכה?", patch["riddle"]!.GetValue<string>());
        var options = patch["options"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
        Assert.Contains("סביבון", options);
        Assert.DoesNotContain("פך השמן", options);
        Assert.DoesNotContain("answer", JsonSerializer.Serialize(snap.Questions));

        Assert.Equal("wrong", engine.SubmitAnswer(room, p.Id, "h1-riddle", J("פך השמן"), T0).Code);
        Assert.Equal("solved", engine.SubmitAnswer(room, p.Id, "h1-riddle", J("סביבונים"), T0).Code);
        Assert.Equal(40, GameEngine.World(room).Score!.Personal[p.Id.ToString()]);
        Assert.Equal(3, GameEngine.World(room).Questions["h1-riddle"].Version);
    }

    [Fact]
    public void Only_question_puzzles_can_take_an_admin_question()
    {
        var slots = Catalog.All.SelectMany(s => s.Puzzles.Where(p => GameEngine.QuestionField(p) != null).Select(p => p.Id)).ToList();
        Assert.Contains("h1-riddle", slots);
        Assert.Contains("h8-final", slots);
        Assert.DoesNotContain("h3-box", slots); // a code lock depends on clues in the room
        Assert.DoesNotContain("h7-mosaic", slots);
    }
}

/// <summary>
/// A game question stored in the database is fixed when a game starts and checked on the server; the admin screen for
/// these questions was removed, so its URLs no longer exist.
/// </summary>
[Collection(DatabaseCollection.Name)]
public class GameQuestionAdminTests(HubIntegrationTests.Factory factory)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private async Task<HttpClient> AdminAsync()
    {
        var http = factory.CreateClient();
        (await http.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        http.DefaultRequestHeaders.Add(AdminAuth.CsrfHeader, "1");
        return http;
    }

    /// <summary>A Hanukkah game with one player, started and playing (over the real hub, so the server reads the questions).</summary>
    private async Task<HubConnection> PlayingGameAsync()
    {
        var http = factory.CreateClient();
        var (code, claim) = await TestPurchase.PaidRoomAsync(http, factory.Services, "hanukkah-oil");
        var join = await (await http.PostAsJsonAsync($"/api/rooms/{code}/players", new { nickname = "בודק", characterId = "explorer", appearance = "{}", hostClaim = claim }))
            .Content.ReadFromJsonAsync<JsonElement>(Json);
        var server = factory.Server;
        var conn = new HubConnectionBuilder().WithUrl(new Uri(server.BaseAddress, "/hubs/game"), o =>
        {
            o.Transports = HttpTransportType.LongPolling;
            o.HttpMessageHandlerFactory = _ => server.CreateHandler();
        }).Build();
        await conn.StartAsync();
        Assert.True((await conn.InvokeAsync<JsonElement>("Connect", join.GetProperty("token").GetString())).GetProperty("ok").GetBoolean());
        Assert.True((await conn.InvokeAsync<JsonElement>("StartGame")).GetProperty("ok").GetBoolean());
        Assert.True((await conn.InvokeAsync<JsonElement>("FinishIntro", true)).GetProperty("ok").GetBoolean());
        return conn;
    }

    private static async Task<string> Answer(HubConnection conn, string text) =>
        (await conn.InvokeAsync<JsonElement>("SubmitAnswer", "h1-riddle", JsonSerializer.SerializeToElement(text), Guid.NewGuid().ToString("N"))).GetProperty("code").GetString()!;

    [Fact]
    public async Task A_stored_question_reaches_new_games_only_and_the_admin_screen_is_gone()
    {
        var admin = await AdminAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync("/api/admin/game-questions")).StatusCode);
        var before = await PlayingGameAsync(); // started before the question exists

        var id = Guid.NewGuid();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
            db.GameQuestions.Add(new GameQuestion
            {
                Id = id, ScenarioId = "hanukkah-oil", PuzzleId = "h1-riddle", Zone = "library", Question = "מה מסובבים בחנוכה?", Answer = "סביבון קטן",
                AcceptJson = "[]", Difficulty = "קלה", Active = true, Version = 1, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
            });
            await db.SaveChangesAsync();
        }
        try
        {
            var fresh = await PlayingGameAsync();
            Assert.Equal("wrong", await Answer(fresh, "פך השמן"));
            Assert.Equal("solved", await Answer(fresh, "סביבון קטן"));
            await fresh.DisposeAsync();
            // the game that was already running keeps the question it started with
            Assert.Equal("solved", await Answer(before, "פך השמן"));
        }
        finally
        {
            // other tests play the built-in riddle; the row stays, only switched off
            using var scope = factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
            var q = await db.GameQuestions.SingleAsync(x => x.Id == id);
            q.Active = false;
            await db.SaveChangesAsync();
            await before.DisposeAsync();
        }
    }
}

/// <summary>The purchase opening time of a game: set by the admin in Israel time, enforced on the server for every purchase path.</summary>
[Collection(DatabaseCollection.Name)]
public class SaleWindowTests(HubIntegrationTests.Factory factory)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public void Opening_times_are_read_in_Israel_time_and_decide_the_state()
    {
        // winter (UTC+2) and summer (UTC+3) in Israel
        Assert.Equal(new DateTime(2026, 12, 13, 18, 0, 0, DateTimeKind.Utc), PortalX.Server.Payments.SaleWindow.FromIsrael("2026-12-13", "20:00"));
        Assert.Equal(new DateTime(2026, 7, 1, 6, 30, 0, DateTimeKind.Utc), PortalX.Server.Payments.SaleWindow.FromIsrael("2026-07-01", "09:30"));
        Assert.Null(PortalX.Server.Payments.SaleWindow.FromIsrael("2026-12-13", null));
        Assert.Null(PortalX.Server.Payments.SaleWindow.FromIsrael("13/12/2026", "20:00"));
        var p = new Product { SaleOpensAt = new DateTime(2026, 12, 13, 18, 0, 0, DateTimeKind.Utc) };
        Assert.Equal("scheduled", PortalX.Server.Payments.SaleWindow.State(p, p.SaleOpensAt.Value.AddSeconds(-1)));
        Assert.Equal("open", PortalX.Server.Payments.SaleWindow.State(p, p.SaleOpensAt.Value)); // opens by itself on time
        Assert.Equal("13.12.2026 בשעה 20:00", PortalX.Server.Payments.SaleWindow.Label(p.SaleOpensAt.Value));
        p.SalePaused = true;
        Assert.Equal("paused", PortalX.Server.Payments.SaleWindow.State(p, p.SaleOpensAt.Value.AddDays(1)));
        Assert.Equal("open", PortalX.Server.Payments.SaleWindow.State(new Product(), DateTime.UtcNow)); // nothing set: as before
    }

    private async Task<HttpClient> AdminAsync()
    {
        var http = factory.CreateClient();
        (await http.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        http.DefaultRequestHeaders.Add(AdminAuth.CsrfHeader, "1");
        return http;
    }

    private static async Task<JsonElement> Read(HttpResponseMessage r) => await r.Content.ReadFromJsonAsync<JsonElement>(Json);

    [Fact]
    public async Task Before_its_opening_time_a_game_cannot_be_bought_by_any_path()
    {
        await TestPurchase.EnsureProductAsync(factory.Services);
        var id = TestPurchase.ProductId;
        var admin = await AdminAsync();
        var http = factory.CreateClient();
        // an order started while the game was open (its payment page is still around)
        var early = await TestPurchase.CreateOrderAsync(http, factory.Services);
        var future = PortalX.Server.Payments.SaleWindow.ToIsrael(DateTime.UtcNow.AddDays(3));
        try
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await http.PutAsJsonAsync($"/api/admin/products/{id}", new { saleDate = "2030-01-01", saleTime = "10:00" })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/admin/products/{id}", new { saleDate = "2030-01-01" })).StatusCode);
            var saved = await Read(await admin.PutAsJsonAsync($"/api/admin/products/{id}",
                new { saleDate = future.ToString("yyyy-MM-dd"), saleTime = future.ToString("HH:mm"), showBeforeSale = true }));
            Assert.Equal(future.ToString("yyyy-MM-dd"), saved.GetProperty("saleDate").GetString());
            Assert.Equal(future.ToString("HH:mm"), saved.GetProperty("saleTime").GetString());
            Assert.Equal("scheduled", saved.GetProperty("saleState").GetString());

            // shown, priced, without a working purchase, with the opening time
            var view = await Read(await http.GetAsync($"/api/products/{id}"));
            Assert.Equal("scheduled", view.GetProperty("saleState").GetString());
            Assert.False(view.GetProperty("purchasable").GetBoolean());
            Assert.Equal(TestPurchase.Price, view.GetProperty("price").GetDecimal());
            Assert.Contains("בשעה", view.GetProperty("saleOpensLabel").GetString());

            // the server refuses a new order and the start of a payment, whatever the page shows
            var order = await http.PostAsJsonAsync("/api/orders", new { productId = id });
            Assert.Equal(HttpStatusCode.Conflict, order.StatusCode);
            Assert.Equal("sale-not-open", (await Read(order)).GetProperty("code").GetString());
            var pay = await TestPurchase.PayAsync(http, early);
            Assert.Equal(HttpStatusCode.Conflict, pay.StatusCode);

            // hidden before the opening when the admin chose so
            await admin.PutAsJsonAsync($"/api/admin/products/{id}", new { showBeforeSale = false });
            Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync($"/api/products/{id}")).StatusCode);

            // paused by hand: no new order even after the opening time
            await admin.PutAsJsonAsync($"/api/admin/products/{id}", new { saleDate = "2020-01-01", saleTime = "00:00", salePaused = true });
            var paused = await http.PostAsJsonAsync("/api/orders", new { productId = id });
            Assert.Equal("sale-paused", (await Read(paused)).GetProperty("code").GetString());

            // the opening time has passed and the pause is off: open by itself
            await admin.PutAsJsonAsync($"/api/admin/products/{id}", new { salePaused = false });
            Assert.True((await Read(await http.GetAsync($"/api/products/{id}"))).GetProperty("purchasable").GetBoolean());
            Assert.Equal(HttpStatusCode.OK, (await http.PostAsJsonAsync("/api/orders", new { productId = id })).StatusCode);
            (await TestPurchase.PayAsync(http, early)).EnsureSuccessStatusCode();

            var audit = await Read(await admin.GetAsync("/api/admin/audit"));
            Assert.Contains(audit.EnumerateArray(), e => e.GetProperty("action").GetString() == "product-sale-changed");
        }
        finally
        {
            // back to no opening time: exactly as before
            await admin.PutAsJsonAsync($"/api/admin/products/{id}", new { clearSaleOpening = true, showBeforeSale = true, salePaused = false });
        }
        var plain = await Read(await http.GetAsync($"/api/products/{id}"));
        Assert.Equal("open", plain.GetProperty("saleState").GetString());
        Assert.True(plain.GetProperty("purchasable").GetBoolean());
    }
}
