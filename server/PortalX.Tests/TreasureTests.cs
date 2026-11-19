using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Admin;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Payments;
using PortalX.Server.Treasure;
using static PortalX.Tests.TestPurchase;

namespace PortalX.Tests;

/// <summary>
/// The treasure chest ("תיבת האוצר"): one server-side draw per paid order, its coupon and gift prizes, the fallback, the
/// refund policy, the admin settings and the weighted draw itself.
/// </summary>
[Collection(DatabaseCollection.Name)]
public class TreasureTests : IAsyncLifetime
{
    private readonly HubIntegrationTests.Factory _factory;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public TreasureTests(HubIntegrationTests.Factory factory) => _factory = factory;

    private const string GiftA = "test-treasure-gift-a";
    private const string GiftB = "test-treasure-gift-b";

    public async Task InitializeAsync()
    {
        await EnsureProductAsync(_factory.Services);
        await AddProductAsync(GiftA, 70m);
        await AddProductAsync(GiftB, 90m);
        await DbAsync(async db => { await db.TreasureGiftProducts.ExecuteDeleteAsync(); return 0; });
    }

    /// <summary>The chest is switched off again after every test, so the other test classes never draw.</summary>
    public async Task DisposeAsync()
    {
        await SaveConfigAsync(false, TreasureRules.Defaults(), TreasureRules.DefaultFallback);
        await DbAsync(async db => { await db.TreasureGiftProducts.ExecuteDeleteAsync(); return 0; });
    }

    // ------------------------------------------------------------------ helpers

    private async Task<T> DbAsync<T>(Func<PortalDbContext, Task<T>> f)
    {
        using var scope = _factory.Services.CreateScope();
        return await f(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
    }

    private async Task<T> TreasureAsync<T>(Func<TreasureService, Task<T>> f)
    {
        using var scope = _factory.Services.CreateScope();
        return await f(scope.ServiceProvider.GetRequiredService<TreasureService>());
    }

    private async Task AddProductAsync(string id, decimal price) => await DbAsync(async db =>
    {
        if (await db.Products.AnyAsync(p => p.Id == id)) return 0;
        db.Products.Add(new Product
        {
            Id = id, Name = "מתנת בדיקה " + id[^1], PriceIls = price, Status = ProductStatus.Published, ScenarioId = "last-portal",
            MinPlayers = 1, MaxPlayers = 4, SortOrder = 98, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        });
        try { await db.SaveChangesAsync(); } catch (DbUpdateException) { }
        return 0;
    });

    private async Task<TreasureConfig> SaveConfigAsync(bool enabled, List<TreasurePrize> prizes, string fallback)
    {
        var (config, error) = await TreasureAsync(t => t.SaveConfigAsync(new TreasureConfigInput(enabled, fallback, prizes), "test"));
        Assert.Null(error);
        return config!;
    }

    /// <summary>Settings where one prize always wins (100%); the others stay configured with 0%.</summary>
    private Task<TreasureConfig> OnlyAsync(string key, string fallback = TreasureRules.DefaultFallback, Func<TreasurePrize, TreasurePrize>? edit = null) =>
        SaveConfigAsync(true, TreasureRules.Defaults().Select(p => p.Key == key ? (edit ?? (x => x))(p with { Weight = TreasureRules.TotalWeight }) : p with { Weight = 0 }).ToList(), fallback);

    private Task SetGiftsAsync(params string[] ids) => DbAsync(async db =>
    {
        await db.TreasureGiftProducts.ExecuteDeleteAsync();
        foreach (var id in ids) db.TreasureGiftProducts.Add(new TreasureGiftProduct { ProductId = id, AddedBy = "test", AddedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        return 0;
    });

    private static string NewEmail() => $"chest-{Guid.NewGuid():N}@example.com";

    private async Task<Purchase> PaidAsync(HttpClient http, string? email, string productId = ProductId)
    {
        var p = await CreateOrderAsync(http, _factory.Services, productId, email);
        (await PayAsync(http, p)).EnsureSuccessStatusCode();
        return p;
    }

    private Task<TreasureWin?> WinAsync(Guid orderId) => DbAsync(db => db.TreasureWins.AsNoTracking().FirstOrDefaultAsync(w => w.OrderId == orderId));

    /// <summary>The API leaves null values out of its JSON.</summary>
    private static bool Missing(JsonElement e, string name) => !e.TryGetProperty(name, out var v) || v.ValueKind == JsonValueKind.Null;

    private static async Task<JsonElement> JsonOf(HttpResponseMessage r)
    {
        Assert.True(r.IsSuccessStatusCode, $"{(int)r.StatusCode}: {await r.Content.ReadAsStringAsync()}");
        return await r.Content.ReadFromJsonAsync<JsonElement>(Json);
    }

    private static Task<HttpResponseMessage> ChestAsync(HttpClient http, Purchase p) =>
        http.SendAsync(WithKey(HttpMethod.Get, $"/api/orders/{p.OrderId}/treasure", p.Key));

    private static Task<HttpResponseMessage> RevealAsync(HttpClient http, Purchase p, string? email = null)
    {
        var req = WithKey(HttpMethod.Post, $"/api/orders/{p.OrderId}/treasure/reveal", p.Key);
        req.Content = JsonContent.Create(new { email });
        return http.SendAsync(req);
    }

    private static Task<HttpResponseMessage> OrderWithCouponAsync(HttpClient http, string code, string? email, string productId = ProductId) =>
        http.PostAsJsonAsync("/api/orders", new { productId, email, couponCode = code });

    /// <summary>A paid order written straight to the database (as if the draw after the payment never ran).</summary>
    private Task<Guid> InsertPaidOrderAsync(string? email, DateTime? paidAt = null) => DbAsync(async db =>
    {
        var now = DateTime.UtcNow;
        var o = new Order
        {
            Id = Guid.NewGuid(), ProductId = ProductId, ProductName = "מוצר בדיקה", PriceSnapshot = Price, OriginalPrice = Price, Currency = "ILS",
            Status = OrderStatus.Paid, Provider = "sandbox", IsTest = true, Email = email, AccessKeyHash = "x", CreatedAt = now, UpdatedAt = now,
            PaidAt = paidAt ?? now, ProviderSessionId = "direct-" + Guid.NewGuid().ToString("N"),
        };
        db.Orders.Add(o);
        await db.SaveChangesAsync();
        return o.Id;
    });

    private async Task<HttpClient> AdminClientAsync()
    {
        var http = _factory.CreateClient();
        (await http.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        http.DefaultRequestHeaders.Add(AdminAuth.CsrfHeader, "1");
        return http;
    }

    // ------------------------------------------------------------------ 1–4: the trigger

    [Fact]
    public async Task Successful_purchase_draws_exactly_once_with_the_active_settings()
    {
        var config = await OnlyAsync("none");
        var http = _factory.CreateClient();
        var p = await PaidAsync(http, NewEmail());

        var win = await WinAsync(p.OrderId);
        Assert.NotNull(win);
        Assert.Equal(config.Id, win!.ConfigId);
        Assert.InRange(win.Roll, 0, 9999);
        Assert.Equal("none", JsonDocument.Parse(win.PrizeSnapshotJson).RootElement.GetProperty("key").GetString());
    }

    [Theory]
    [InlineData("decline")]
    [InlineData("cancel")]
    public async Task Failed_or_cancelled_purchase_has_no_draw(string outcome)
    {
        await OnlyAsync("off-10");
        var http = _factory.CreateClient();
        var p = await CreateOrderAsync(http, _factory.Services, email: NewEmail());
        Assert.Null(await WinAsync(p.OrderId));                                       // nothing before the payment is confirmed
        (await PayAsync(http, p, outcome)).EnsureSuccessStatusCode();

        Assert.Null(await WinAsync(p.OrderId));
        var view = await JsonOf(await ChestAsync(http, p));
        Assert.Equal("none", view.GetProperty("state").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await RevealAsync(http, p)).StatusCode);
    }

    [Fact]
    public async Task Repeated_payment_notifications_and_retries_never_draw_twice()
    {
        await OnlyAsync("off-20");
        var http = _factory.CreateClient();
        var p = await PaidAsync(http, NewEmail());
        var first = await WinAsync(p.OrderId);

        // the provider repeats its notification, and the buyer's page asks again and again
        var order = await DbAsync(db => db.Orders.AsNoTracking().FirstAsync(o => o.Id == p.OrderId));
        var body = SandboxPaymentProvider.BuildBody(order, PaymentEventType.Succeeded, order.ProviderTransactionId);
        var sandbox = (SandboxPaymentProvider)_factory.Services.GetRequiredService<PaymentGateway>().Provider!;
        for (var i = 0; i < 2; i++)
        {
            var req = new HttpRequestMessage(HttpMethod.Post, "/api/payments/webhook/sandbox") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
            req.Headers.Add(SandboxPaymentProvider.SignatureHeader, sandbox.Sign(body));
            (await http.SendAsync(req)).EnsureSuccessStatusCode();
        }
        for (var i = 0; i < 3; i++) await JsonOf(await ChestAsync(http, p));
        await TreasureAsync(t => t.EnsureDrawAsync(p.OrderId));

        Assert.Equal(1, await DbAsync(db => db.TreasureWins.CountAsync(w => w.OrderId == p.OrderId)));
        Assert.Equal(first!.Id, (await WinAsync(p.OrderId))!.Id);
        Assert.Equal(1, await DbAsync(db => db.Coupons.CountAsync(c => c.Id == first.CouponId)));
    }

    [Fact]
    public async Task No_prize_shows_a_thank_you_and_never_a_winning_message()
    {
        await OnlyAsync("none");
        var http = _factory.CreateClient();
        var p = await PaidAsync(http, NewEmail());

        var view = await JsonOf(await ChestAsync(http, p));
        Assert.Equal("drawn", view.GetProperty("state").GetString());
        Assert.False(view.GetProperty("hasPrize").GetBoolean());
        var prize = view.GetProperty("prize");
        Assert.Equal("none", prize.GetProperty("kind").GetString());
        Assert.True(Missing(prize, "coupon"));
        Assert.DoesNotContain("זכיתם", prize.GetProperty("title").GetString());
        var win = await WinAsync(p.OrderId);
        Assert.Equal(TreasureWinStatus.NoPrize, win!.Status);
        Assert.Null(win.CouponId);
        Assert.Null(win.EntitlementId);
    }

    // ------------------------------------------------------------------ 5–7: coupons

    [Theory]
    [InlineData("off-10", 10)]
    [InlineData("off-20", 20)]
    [InlineData("off-30", 30)]
    public async Task Discount_prize_issues_a_personal_one_use_coupon_for_30_days(string key, int percent)
    {
        await OnlyAsync(key);
        var http = _factory.CreateClient();
        var email = NewEmail();
        var p = await PaidAsync(http, email);

        // nothing about the prize before the chest is opened
        var before = await JsonOf(await ChestAsync(http, p));
        Assert.True(before.GetProperty("hasPrize").GetBoolean());
        Assert.False(before.GetProperty("revealed").GetBoolean());
        Assert.True(Missing(before, "prize"));

        var view = await JsonOf(await RevealAsync(http, p));
        var coupon = view.GetProperty("prize").GetProperty("coupon");
        Assert.Equal(percent, coupon.GetProperty("percent").GetDecimal());
        Assert.Equal("active", coupon.GetProperty("status").GetString());
        var code = coupon.GetProperty("code").GetString()!;

        var win = await WinAsync(p.OrderId);
        var stored = await DbAsync(db => db.Coupons.AsNoTracking().Include(c => c.Products).FirstAsync(c => c.Id == win!.CouponId));
        Assert.Equal(code, stored.Code);
        Assert.Equal(1, stored.MaxRedemptions);
        Assert.Equal(CouponKind.Percent, stored.Kind);
        Assert.InRange((stored.EndsAt!.Value - stored.CreatedAt).TotalDays, 29.9, 30.1);
        Assert.Contains(stored.Products, x => x.ProductId == ProductId);
        Assert.Equal(email, win!.Email);
        Assert.Equal("treasure", await DbAsync(db => db.CouponCampaigns.Where(c => c.Id == stored.CampaignId).Select(c => c.Kind).FirstAsync()));

        // a later purchase with the same address: the discount is the server's, never the browser's
        var next = await JsonOf(await OrderWithCouponAsync(http, code, email));
        Assert.Equal(Price * percent / 100m, next.GetProperty("discount").GetDecimal());
        Assert.Equal(Price - Price * percent / 100m, next.GetProperty("price").GetDecimal());
    }

    // ------------------------------------------------------------------ 8–9, 20: gift games

    [Fact]
    public async Task Gift_prize_grants_an_entitlement_without_a_fake_order_and_opens_a_game()
    {
        await OnlyAsync("gift");
        await SetGiftsAsync(GiftA);
        var http = _factory.CreateClient();
        var p = await PaidAsync(http, NewEmail());
        var ordersBefore = await DbAsync(db => db.Orders.CountAsync());

        var win = await WinAsync(p.OrderId);
        Assert.Equal(TreasureWinStatus.Gift, win!.Status);
        Assert.Equal(GiftA, win.GiftProductId);
        var ent = await DbAsync(db => db.Entitlements.AsNoTracking().FirstAsync(e => e.Id == win.EntitlementId));
        Assert.Equal(EntitlementSource.TreasureReward, ent.Source);
        Assert.Null(ent.OrderId);
        Assert.Equal(GiftA, ent.ProductId);
        Assert.Equal(70m, win.CostIls);

        // the gift opens only after the chest was opened, through the same game flow as a bought game
        Assert.Equal(HttpStatusCode.NotFound, (await http.SendAsync(WithKey(HttpMethod.Post, $"/api/orders/{p.OrderId}/treasure/game", p.Key))).StatusCode);
        var view = await JsonOf(await RevealAsync(http, p));
        Assert.Equal(GiftA, view.GetProperty("prize").GetProperty("gift").GetProperty("productId").GetString());
        var game = await JsonOf(await http.SendAsync(WithKey(HttpMethod.Post, $"/api/orders/{p.OrderId}/treasure/game", p.Key)));
        var code = game.GetProperty("code").GetString()!;
        Assert.Equal("treasure", await DbAsync(db => db.Rooms.Where(r => r.Code == code).Select(r => r.AccessSource).FirstAsync()));
        // the bought game is still its own, separate one
        var bought = await JsonOf(await OpenGameAsync(http, p));
        Assert.NotEqual(code, bought.GetProperty("code").GetString());
        Assert.Equal(ordersBefore, await DbAsync(db => db.Orders.CountAsync()));
    }

    [Fact]
    public async Task Buyer_who_owns_every_gift_game_gets_the_fallback_never_a_game_they_have()
    {
        await OnlyAsync("gift");
        await SetGiftsAsync(GiftA, ProductId);
        var http = _factory.CreateClient();
        var email = NewEmail();
        // the same address already bought gift A; now it buys the test game (the other gift on the list)
        await DbAsync(async db => { await db.TreasureGiftProducts.Where(g => g.ProductId == GiftA).ExecuteDeleteAsync(); return 0; });
        await PaidAsync(http, email, GiftA);
        await SetGiftsAsync(GiftA, ProductId);
        var p = await PaidAsync(http, email);

        var win = await WinAsync(p.OrderId);
        Assert.Equal("gift", win!.DrawnKey);
        Assert.True(win.IsFallback);
        Assert.Equal("no-gift-game", win.FallbackReason);
        Assert.Equal(TreasureRules.DefaultFallback, win.PrizeKey);
        Assert.Equal(TreasureWinStatus.Coupon, win.Status);
        Assert.Null(win.EntitlementId);
    }

    [Fact]
    public async Task Gift_is_never_the_game_just_bought()
    {
        await OnlyAsync("gift");
        await SetGiftsAsync(ProductId, GiftB);
        var http = _factory.CreateClient();
        for (var i = 0; i < 4; i++)
        {
            var p = await PaidAsync(http, NewEmail());
            Assert.Equal(GiftB, (await WinAsync(p.OrderId))!.GiftProductId);
        }
    }

    [Fact]
    public async Task No_gift_games_available_uses_the_configured_fallback()
    {
        await SetGiftsAsync();
        await OnlyAsync("gift", fallback: "off-10");
        var http = _factory.CreateClient();
        var p = await PaidAsync(http, NewEmail());
        var win = await WinAsync(p.OrderId);
        Assert.Equal(("off-10", "no-gift-game", TreasureWinStatus.Coupon), (win!.PrizeKey, win.FallbackReason, win.Status));

        await OnlyAsync("gift", fallback: "none");
        var q = await PaidAsync(http, NewEmail());
        var none = await WinAsync(q.OrderId);
        Assert.Equal(("none", TreasureWinStatus.NoPrize), (none!.PrizeKey, none.Status));
        Assert.Null(none.EntitlementId);
    }

    [Fact]
    public async Task Prize_limit_and_budget_fall_back_and_a_full_fallback_gives_nothing()
    {
        var http = _factory.CreateClient();
        await OnlyAsync("off-20", edit: p => p with { MaxWins = 0 });
        Assert.Equal(("off-30", "limit"), await KeyAsync());
        await OnlyAsync("off-20", edit: p => p with { BudgetIls = 1 });
        Assert.Equal(("off-30", "budget"), await KeyAsync());
        // the fallback itself is used up as well: no prize, recorded as such
        await SaveConfigAsync(true, TreasureRules.Defaults().Select(p => p with
        {
            Weight = p.Key == "off-20" ? 10000 : 0, MaxWins = p.Key is "off-20" or "off-30" ? 0 : null,
        }).ToList(), "off-30");
        Assert.Equal(("none", "limit"), await KeyAsync());

        async Task<(string, string?)> KeyAsync()
        {
            var w = await WinAsync((await PaidAsync(http, NewEmail())).OrderId);
            return (w!.PrizeKey, w.FallbackReason);
        }
    }

    // ------------------------------------------------------------------ 10–12: using the coupon

    private async Task<(Purchase P, string Code, string Email)> CouponWinAsync(HttpClient http, string key = "off-10")
    {
        await OnlyAsync(key);
        var email = NewEmail();
        var p = await PaidAsync(http, email);
        var view = await JsonOf(await RevealAsync(http, p));
        return (p, view.GetProperty("prize").GetProperty("coupon").GetProperty("code").GetString()!, email);
    }

    [Fact]
    public async Task Expired_coupon_is_refused_at_checkout()
    {
        var http = _factory.CreateClient();
        var (_, code, email) = await CouponWinAsync(http);
        await DbAsync(db => db.Coupons.Where(c => c.Code == code).ExecuteUpdateAsync(u => u.SetProperty(c => c.EndsAt, DateTime.UtcNow.AddMinutes(-1))));
        var res = await OrderWithCouponAsync(http, code, email);
        Assert.Equal(HttpStatusCode.Gone, res.StatusCode);
        Assert.Contains("expired", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Coupon_is_used_once_only()
    {
        var http = _factory.CreateClient();
        var (_, code, email) = await CouponWinAsync(http);
        var first = await JsonOf(await OrderWithCouponAsync(http, code, email));
        var session = first.GetProperty("checkoutUrl").GetString()!.Split('/')[^1];
        (await http.PostAsJsonAsync($"/api/sandbox/checkout/{session}", new { outcome = "approve" })).EnsureSuccessStatusCode();

        var again = await OrderWithCouponAsync(http, code, email);
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Contains("used-up", await again.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Coupon_is_refused_for_another_address_an_unopened_chest_and_a_game_it_does_not_cover()
    {
        var http = _factory.CreateClient();
        var (_, code, email) = await CouponWinAsync(http);
        // not transferable
        var other = await OrderWithCouponAsync(http, code, NewEmail());
        Assert.Equal(HttpStatusCode.Forbidden, other.StatusCode);
        Assert.Contains("treasure-email", await other.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Forbidden, (await OrderWithCouponAsync(http, code, null)).StatusCode);
        // a game the coupon does not cover (e.g. added to the catalog after it was issued) is refused
        await DbAsync(db => db.CouponProducts.Where(x => x.ProductId == GiftB && db.Coupons.Any(c => c.Id == x.CouponId && c.Code == code)).ExecuteDeleteAsync());
        var late = await OrderWithCouponAsync(http, code, email, GiftB);
        Assert.Equal(HttpStatusCode.Conflict, late.StatusCode);
        Assert.Contains("wrong-product", await late.Content.ReadAsStringAsync());

        // a buyer without an address must bind one when opening the chest; until then the code is unknown and unusable
        await OnlyAsync("off-10");
        var p = await PaidAsync(http, null);
        var ask = await RevealAsync(http, p);
        Assert.Equal(HttpStatusCode.BadRequest, ask.StatusCode);
        Assert.Contains("email-required", await ask.Content.ReadAsStringAsync());
        var unboundId = (await WinAsync(p.OrderId))!.CouponId;
        var unbound = await DbAsync(db => db.Coupons.AsNoTracking().Where(c => c.Id == unboundId).Select(c => c.Code).FirstAsync());
        var refused = await OrderWithCouponAsync(http, unbound, NewEmail());
        Assert.Contains("treasure-unbound", await refused.Content.ReadAsStringAsync());
        var mine = NewEmail();
        var opened = await JsonOf(await RevealAsync(http, p, mine.ToUpperInvariant()));
        Assert.Equal(unbound, opened.GetProperty("prize").GetProperty("coupon").GetProperty("code").GetString());
        Assert.Equal(mine, (await WinAsync(p.OrderId))!.Email);
        await JsonOf(await OrderWithCouponAsync(http, unbound, mine));
    }

    // ------------------------------------------------------------------ 13: refunds

    [Fact]
    public async Task Refund_of_the_purchase_cancels_an_unused_coupon_and_revokes_an_unopened_gift()
    {
        var http = _factory.CreateClient();
        var (p, code, email) = await CouponWinAsync(http);
        await OnlyAsync("gift");
        await SetGiftsAsync(GiftA);
        var g = await PaidAsync(http, NewEmail());

        using (var scope = _factory.Services.CreateScope())
        {
            var purchases = scope.ServiceProvider.GetRequiredService<PurchaseService>();
            Assert.True((await purchases.MarkRefundedAsync(p.OrderId)).Ok);
            Assert.True((await purchases.MarkRefundedAsync(g.OrderId)).Ok);
        }

        Assert.Equal(TreasureWinStatus.Revoked, (await WinAsync(p.OrderId))!.Status);
        var refused = await OrderWithCouponAsync(http, code, email);
        Assert.Equal(HttpStatusCode.Gone, refused.StatusCode);
        Assert.Contains("cancelled", await refused.Content.ReadAsStringAsync());

        var gift = await WinAsync(g.OrderId);
        Assert.Equal(TreasureWinStatus.Revoked, gift!.Status);
        Assert.True(await DbAsync(db => db.Entitlements.Where(e => e.Id == gift.EntitlementId).Select(e => e.Revoked).FirstAsync()));
        await RevealAsync(http, g);
        Assert.NotEqual(HttpStatusCode.OK, (await http.SendAsync(WithKey(HttpMethod.Post, $"/api/orders/{g.OrderId}/treasure/game", g.Key))).StatusCode);
    }

    [Fact]
    public async Task Refund_after_the_coupon_was_used_keeps_it_as_used()
    {
        var http = _factory.CreateClient();
        var (p, code, email) = await CouponWinAsync(http);
        var next = await JsonOf(await OrderWithCouponAsync(http, code, email));
        (await http.PostAsJsonAsync($"/api/sandbox/checkout/{next.GetProperty("checkoutUrl").GetString()!.Split('/')[^1]}", new { outcome = "approve" })).EnsureSuccessStatusCode();
        using (var scope = _factory.Services.CreateScope())
            Assert.True((await scope.ServiceProvider.GetRequiredService<PurchaseService>().MarkRefundedAsync(p.OrderId)).Ok);
        Assert.Equal(TreasureWinStatus.Coupon, (await WinAsync(p.OrderId))!.Status);
        Assert.Null(await DbAsync(db => db.Coupons.Where(c => c.Code == code).Select(c => c.CancelledAt).FirstAsync()));
    }

    // ------------------------------------------------------------------ 14–16: refresh, parallel calls, settings changes

    [Fact]
    public async Task Refresh_and_return_visits_show_the_same_prize_and_keep_an_unopened_chest()
    {
        await OnlyAsync("off-30");
        var http = _factory.CreateClient();
        var p = await PaidAsync(http, NewEmail());

        // the buyer leaves without opening it and comes back later from another browser with the recovery key
        var later = _factory.CreateClient();
        for (var i = 0; i < 3; i++)
        {
            var v = await JsonOf(await ChestAsync(later, p));
            Assert.True(v.GetProperty("hasPrize").GetBoolean());
            Assert.False(v.GetProperty("revealed").GetBoolean());
        }
        var a = await JsonOf(await RevealAsync(later, p));
        var revealedAt = (await WinAsync(p.OrderId))!.RevealedAt;
        var b = await JsonOf(await RevealAsync(http, p));
        var c = await JsonOf(await ChestAsync(http, p));
        string Code(JsonElement e) => e.GetProperty("prize").GetProperty("coupon").GetProperty("code").GetString()!;
        Assert.Equal(Code(a), Code(b));
        Assert.Equal(Code(a), Code(c));
        Assert.True(c.GetProperty("revealed").GetBoolean());
        Assert.Equal(revealedAt, (await WinAsync(p.OrderId))!.RevealedAt);
        Assert.Equal(1, await DbAsync(db => db.TreasureWins.CountAsync(w => w.OrderId == p.OrderId)));
    }

    [Fact]
    public async Task Parallel_calls_on_an_undrawn_order_make_one_draw_and_one_prize()
    {
        await OnlyAsync("off-10");
        var orderId = await InsertPaidOrderAsync(NewEmail());
        var start = await DbAsync(db => db.Coupons.CountAsync());
        var ids = await Task.WhenAll(Enumerable.Range(0, 12).Select(_ => TreasureAsync(t => t.EnsureDrawAsync(orderId))));

        Assert.Single(ids.Select(w => w!.Id).Distinct());
        Assert.Equal(1, await DbAsync(db => db.TreasureWins.CountAsync(w => w.OrderId == orderId)));
        Assert.NotNull(ids[0]!.CouponId);
        // the calls that lost the race left no coupon of their own behind
        Assert.Equal(start + 1, await DbAsync(db => db.Coupons.CountAsync()));
    }

    [Fact]
    public async Task Settings_saved_later_never_change_an_earlier_draw()
    {
        var a = await OnlyAsync("off-10");
        var http = _factory.CreateClient();
        var early = await PaidAsync(http, NewEmail());
        // an order paid under the first settings but drawn only after the change (e.g. the server restarted in between)
        var lateDraw = await InsertPaidOrderAsync(NewEmail(), DateTime.UtcNow);
        await Task.Delay(20);
        var b = await OnlyAsync("off-20");
        var next = await PaidAsync(http, NewEmail());

        Assert.Equal((a.Id, "off-10"), ((await WinAsync(early.OrderId))!.ConfigId, (await WinAsync(early.OrderId))!.PrizeKey));
        var w = await TreasureAsync(t => t.EnsureDrawAsync(lateDraw));
        Assert.Equal((a.Id, "off-10"), (w!.ConfigId, w.PrizeKey));
        Assert.Equal((b.Id, "off-20"), ((await WinAsync(next.OrderId))!.ConfigId, (await WinAsync(next.OrderId))!.PrizeKey));
        Assert.True(await DbAsync(db => db.TreasureConfigs.AnyAsync(c => c.Id == a.Id && !c.IsActive)));
    }

    [Fact]
    public async Task Orders_paid_while_the_chest_was_off_never_draw()
    {
        await SaveConfigAsync(false, TreasureRules.Defaults(), TreasureRules.DefaultFallback);
        var http = _factory.CreateClient();
        var p = await PaidAsync(http, NewEmail());
        await OnlyAsync("off-30");
        Assert.Equal("none", (await JsonOf(await ChestAsync(http, p))).GetProperty("state").GetString());
        Assert.Null(await WinAsync(p.OrderId));
    }

    // ------------------------------------------------------------------ 17–18: settings and admin rights

    [Fact]
    public async Task Settings_whose_chances_do_not_add_up_to_100_are_refused()
    {
        var active = await OnlyAsync("off-10");
        var wrong = TreasureRules.Defaults().Select(p => p.Key == "none" ? p with { Weight = 7999 } : p).ToList();
        var (config, error) = await TreasureAsync(t => t.SaveConfigAsync(new TreasureConfigInput(true, "off-30", wrong), "test"));
        Assert.Null(config);
        Assert.Contains("100%", error);

        var admin = await AdminClientAsync();
        var res = await admin.PutAsJsonAsync("/api/admin/treasure/config", new { enabled = true, fallbackKey = "off-30", prizes = wrong });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var gift = await admin.PutAsJsonAsync("/api/admin/treasure/config", new { enabled = true, fallbackKey = "gift", prizes = TreasureRules.Defaults() });
        Assert.Equal(HttpStatusCode.BadRequest, gift.StatusCode);
        Assert.Equal(active.Id, (await TreasureAsync(t => t.ActiveConfigAsync())).Id);

        Assert.Null(TreasureRules.Validate("off-30", TreasureRules.Defaults()));
        Assert.NotNull(TreasureRules.Validate("off-30", TreasureRules.Defaults().Select(p => p.Key == "off-10" ? p with { DiscountPercent = 100 } : p).ToList()));
        Assert.NotNull(TreasureRules.Validate("off-30", TreasureRules.Defaults().Select(p => p with { Key = "same" }).ToList()));
        // a prize switched off no longer counts toward the 100%
        Assert.Null(TreasureRules.Validate("none", TreasureRules.Defaults().Select(p => p.Key == "gift" ? p with { Active = false } : p.Key == "none" ? p with { Weight = 8100 } : p).ToList()));
    }

    [Theory]
    [InlineData("GET", "/api/admin/treasure/config")]
    [InlineData("PUT", "/api/admin/treasure/config")]
    [InlineData("GET", "/api/admin/treasure/gifts")]
    [InlineData("PUT", "/api/admin/treasure/gifts/test-portal")]
    [InlineData("GET", "/api/admin/treasure/stats")]
    [InlineData("GET", "/api/admin/treasure/wins")]
    [InlineData("GET", "/api/admin/treasure/wins.csv")]
    public async Task Treasure_admin_api_needs_an_admin(string method, string url)
    {
        var req = new HttpRequestMessage(new HttpMethod(method), url);
        req.Headers.Add(AdminAuth.CsrfHeader, "1");
        if (method != "GET") req.Content = JsonContent.Create(new { selected = true, enabled = true });
        Assert.Equal(HttpStatusCode.Unauthorized, (await _factory.CreateClient().SendAsync(req)).StatusCode);
    }

    [Fact]
    public async Task Admin_changes_need_the_csrf_header_are_audited_and_the_tab_reports()
    {
        var http = _factory.CreateClient();
        (await http.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        var noHeader = await http.PutAsJsonAsync("/api/admin/treasure/gifts/" + GiftA, new { selected = true });
        Assert.Equal(HttpStatusCode.Forbidden, noHeader.StatusCode);

        var admin = await AdminClientAsync();
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync("/api/admin/treasure/gifts/" + GiftA, new { selected = true })).StatusCode);
        var prizes = TreasureRules.Defaults().Select(p => p.Key == "off-20" ? p with { Weight = 10000 } : p with { Weight = 0 }).ToList();
        await JsonOf(await admin.PutAsJsonAsync("/api/admin/treasure/config", new { enabled = true, fallbackKey = "off-30", prizes }));
        Assert.True(await DbAsync(db => db.AdminAuditLog.AnyAsync(a => a.Action == "treasure-config-saved")));
        Assert.True(await DbAsync(db => db.AdminAuditLog.AnyAsync(a => a.Action == "treasure-gift-added" && a.TargetId == GiftA)));

        var buyer = _factory.CreateClient();
        var email = NewEmail();
        var p = await PaidAsync(buyer, email);
        var gifts = await JsonOf(await admin.GetAsync("/api/admin/treasure/gifts"));
        Assert.Contains(gifts.EnumerateArray(), g => g.GetProperty("id").GetString() == GiftA && g.GetProperty("selected").GetBoolean());
        var stats = await JsonOf(await admin.GetAsync("/api/admin/treasure/stats?includeTest=true"));
        Assert.True(stats.GetProperty("participated").GetInt32() >= 1);
        Assert.True(stats.GetProperty("couponsCreated").GetInt32() >= 1);
        var wins = await JsonOf(await admin.GetAsync($"/api/admin/treasure/wins?includeTest=true&search={email}"));
        var row = Assert.Single(wins.GetProperty("rows").EnumerateArray());
        Assert.Equal("off-20", row.GetProperty("prizeKey").GetString());
        var csv = await admin.GetAsync($"/api/admin/treasure/wins.csv?includeTest=true&search={email}");
        Assert.Equal(HttpStatusCode.OK, csv.StatusCode);
        Assert.Contains(email, await csv.Content.ReadAsStringAsync());
        // a buyer's chest needs the order's own key
        Assert.Equal(HttpStatusCode.NotFound, (await buyer.SendAsync(WithKey(HttpMethod.Get, $"/api/orders/{p.OrderId}/treasure", "wrong-key"))).StatusCode);
    }

    // ------------------------------------------------------------------ 19: database failure

    [Fact]
    public async Task Database_failure_while_creating_the_prize_leaves_nothing_half_made_and_a_later_call_draws_once()
    {
        await OnlyAsync("gift");
        await SetGiftsAsync(GiftA);
        var orderId = await InsertPaidOrderAsync(NewEmail());
        var entitlementsBefore = await DbAsync(db => db.Entitlements.CountAsync(e => e.Source == EntitlementSource.TreasureReward));

        using (var scope = _factory.Services.CreateScope())
        {
            var t = scope.ServiceProvider.GetRequiredService<TreasureService>();
            t.BeforeCommitForTests = () => throw new InvalidOperationException("simulated database failure");
            await Assert.ThrowsAsync<InvalidOperationException>(() => t.EnsureDrawAsync(orderId));
            // the payment hook swallows it, so a payment can never fail because of the chest
            await t.AfterPaidAsync(orderId);
        }
        Assert.Null(await WinAsync(orderId));
        Assert.Equal(entitlementsBefore, await DbAsync(db => db.Entitlements.CountAsync(e => e.Source == EntitlementSource.TreasureReward)));

        var win = await TreasureAsync(t => t.EnsureDrawAsync(orderId));
        Assert.Equal(TreasureWinStatus.Gift, win!.Status);
        Assert.Equal(entitlementsBefore + 1, await DbAsync(db => db.Entitlements.CountAsync(e => e.Source == EntitlementSource.TreasureReward)));
    }

    // ------------------------------------------------------------------ the weighted draw

    [Theory]
    [InlineData(0, "none")]
    [InlineData(7999, "none")]
    [InlineData(8000, "off-10")]
    [InlineData(9199, "off-10")]
    [InlineData(9200, "off-20")]
    [InlineData(9699, "off-20")]
    [InlineData(9700, "off-30")]
    [InlineData(9899, "off-30")]
    [InlineData(9900, "gift")]
    [InlineData(9999, "gift")]
    public void Pick_maps_each_roll_to_its_weight_range(int roll, string key) =>
        Assert.Equal(key, TreasureRules.Pick(TreasureRules.Defaults(), roll).Key);

    [Fact]
    public void Pick_skips_inactive_and_zero_weight_prizes_and_rejects_bad_rolls()
    {
        var prizes = TreasureRules.Defaults().Select(p => p.Key == "none" ? p with { Active = false } : p.Key == "off-10" ? p with { Weight = 9200 } : p).ToList();
        Assert.Equal("off-10", TreasureRules.Pick(prizes, 0).Key);
        Assert.Throws<ArgumentOutOfRangeException>(() => TreasureRules.Pick(prizes, 10000));
        Assert.Throws<ArgumentOutOfRangeException>(() => TreasureRules.Pick(prizes, -1));
    }

    [Fact]
    public void The_secure_draw_honours_the_weights_over_many_rolls()
    {
        const int n = 200_000;
        var prizes = TreasureRules.Defaults();
        var counts = prizes.ToDictionary(p => p.Key, _ => 0);
        for (var i = 0; i < n; i++) counts[TreasureRules.Pick(prizes, TreasureRules.Roll()).Key]++;
        foreach (var p in prizes)
        {
            // within 6 standard deviations of the expected share: never flaky, yet a wrong weight would be far outside
            var expected = p.Weight / (double)TreasureRules.TotalWeight;
            var sd = Math.Sqrt(expected * (1 - expected) / n);
            Assert.InRange(counts[p.Key] / (double)n, expected - 6 * sd, expected + 6 * sd);
        }
    }
}
