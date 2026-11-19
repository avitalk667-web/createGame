using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PortalX.Server.Challenge;
using PortalX.Server.Content;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Mail;
using PortalX.Server.Payments;

namespace PortalX.Server.Treasure;

public sealed record TreasureConfigInput(bool? Enabled, string? FallbackKey, List<TreasurePrize>? Prizes);
public sealed record TreasureRevealRequest(string? Email);

/// <summary>
/// The treasure chest ("תיבת האוצר"): every paid order gets exactly one draw, on the server, with the settings that were
/// active when it was paid. The draw and its prize (a personal coupon in the existing coupon tables, or a gift game as an
/// entitlement of its own) are saved in one transaction, and the order's draw is unique in the database — so a provider
/// retry, a refresh, a return visit or two calls at once all get the same result, never a second one.
/// </summary>
public sealed class TreasureService(
    PortalDbContext db, ScenarioCatalog scenarios, IEmailSender sender, SiteOptions site, ILogger<TreasureService> logger)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    /// <summary>One draw at a time across the site, so the limits and budgets are never passed by two draws at once.</summary>
    private const long DrawLock = 7_741_001;

    /// <summary>Tests only: runs inside the draw's transaction just before it commits (to simulate a database failure).</summary>
    public Func<Task>? BeforeCommitForTests { get; set; }

    public static List<TreasurePrize> Prizes(TreasureConfig c) => JsonSerializer.Deserialize<List<TreasurePrize>>(c.PrizesJson, Json) ?? [];

    // ------------------------------------------------------------------ settings

    /// <summary>The active settings; the first time, the spec's defaults — switched off until the admin turns them on.</summary>
    public async Task<TreasureConfig> ActiveConfigAsync()
    {
        var c = await db.TreasureConfigs.AsNoTracking().FirstOrDefaultAsync(x => x.IsActive);
        if (c != null) return c;
        var now = DateTime.UtcNow;
        c = new TreasureConfig
        {
            IsActive = true, Enabled = false, FallbackKey = TreasureRules.DefaultFallback,
            PrizesJson = JsonSerializer.Serialize(TreasureRules.Defaults(), Json), CreatedBy = "system", CreatedAt = now, UpdatedAt = now,
        };
        db.TreasureConfigs.Add(c);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            return await db.TreasureConfigs.AsNoTracking().FirstAsync(x => x.IsActive);
        }
        db.Entry(c).State = EntityState.Detached;
        return c;
    }

    /// <summary>The settings that were in force at a moment (the latest version saved before it); null before the first one.</summary>
    private Task<TreasureConfig?> ConfigAtAsync(DateTime at) =>
        db.TreasureConfigs.AsNoTracking().Where(x => x.CreatedAt <= at).OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id).FirstOrDefaultAsync();

    /// <summary>Saves a new version and makes it the active one. The previous versions stay as they were (the draws point at them).</summary>
    public async Task<(TreasureConfig? Config, string? Error)> SaveConfigAsync(TreasureConfigInput input, string admin)
    {
        var current = await ActiveConfigAsync();
        var prizes = input.Prizes ?? Prizes(current);
        prizes = prizes.Select(p => p with { Name = (p.Name ?? "").Trim(), Title = (p.Title ?? "").Trim(), Message = (p.Message ?? "").Trim() }).ToList();
        var fallback = input.FallbackKey ?? current.FallbackKey;
        if (TreasureRules.Validate(fallback, prizes) is { } error) return (null, error);
        var now = DateTime.UtcNow;
        var next = new TreasureConfig
        {
            IsActive = true, Enabled = input.Enabled ?? current.Enabled, FallbackKey = fallback,
            PrizesJson = JsonSerializer.Serialize(prizes, Json), CreatedBy = admin, CreatedAt = now, UpdatedAt = now,
        };
        await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var tx = await db.Database.BeginTransactionAsync();
            await db.TreasureConfigs.Where(x => x.IsActive).ExecuteUpdateAsync(u => u.SetProperty(x => x.IsActive, false).SetProperty(x => x.UpdatedAt, now));
            db.TreasureConfigs.Add(next);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
        });
        db.ChangeTracker.Clear();
        return (next, null);
    }

    // ------------------------------------------------------------------ the draw

    /// <summary>
    /// Called right after the payment was applied. Never throws: a failure here never touches the payment, and the next
    /// look at the order's chest draws it (exactly once).
    /// </summary>
    public async Task AfterPaidAsync(Guid orderId)
    {
        try { await EnsureDrawAsync(orderId); }
        catch (Exception ex) { logger.LogError(ex, "Treasure draw for order {Order} failed; it will be retried on the order page", orderId); }
    }

    /// <summary>
    /// The order's draw: the stored one, or a new one if the order is paid and the chest was switched on when it was paid.
    /// Null = this order does not take part.
    /// </summary>
    public async Task<TreasureWin?> EnsureDrawAsync(Guid orderId)
    {
        var existing = await db.TreasureWins.AsNoTracking().FirstOrDefaultAsync(w => w.OrderId == orderId);
        if (existing != null) return existing;
        var order = await db.Orders.AsNoTracking().FirstOrDefaultAsync(o => o.Id == orderId);
        // only a payment the server itself confirmed; never before it and never for a refunded or failed order
        if (order is not { Status: OrderStatus.Paid, PaidAt: { } paidAt }) return null;
        var config = await ConfigAtAsync(paidAt);
        if (config is not { Enabled: true }) return null;
        var campaignId = await CampaignIdAsync(order.ProductId);

        try
        {
            return await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                db.ChangeTracker.Clear();
                await using var tx = await db.Database.BeginTransactionAsync();
                await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({DrawLock})");
                var again = await db.TreasureWins.AsNoTracking().FirstOrDefaultAsync(w => w.OrderId == orderId);
                if (again != null) { await tx.RollbackAsync(); return again; }
                var win = await DrawAsync(order, config, campaignId, DateTime.UtcNow);
                await db.SaveChangesAsync();
                if (BeforeCommitForTests is { } hook) await hook();
                await tx.CommitAsync();
                logger.LogInformation("Treasure draw for order {Number}: {Prize} (drawn {Drawn}{Fallback})",
                    order.Number, win.PrizeKey, win.DrawnKey, win.IsFallback ? ", fallback: " + win.FallbackReason : "");
                return win;
            });
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // another call drew this order at the same moment: that draw is the one
            db.ChangeTracker.Clear();
            return await db.TreasureWins.AsNoTracking().FirstAsync(w => w.OrderId == orderId);
        }
        finally
        {
            db.ChangeTracker.Clear();
        }
    }

    private async Task<TreasureWin> DrawAsync(Order order, TreasureConfig config, Guid campaignId, DateTime now)
    {
        var prizes = Prizes(config);
        var roll = TreasureRules.Roll();
        var drawn = TreasureRules.Pick(prizes, roll);
        var email = ResultsEmailService.NormalizeEmail(order.Email);

        var prize = drawn;
        string? fallbackReason = null;
        var (reason, gift, cost) = await CheckAsync(prize, order, email);
        if (reason != null)
        {
            fallbackReason = reason;
            prize = TreasureRules.Find(prizes, config.FallbackKey);
            (reason, gift, cost) = await CheckAsync(prize, order, email);
            // the fallback cannot be given either (its own limit or budget): nothing, recorded as such
            if (reason != null) (prize, gift, cost) = (TreasureRules.Find([], TreasureRules.NoneKey), null, 0m);
        }

        var win = new TreasureWin
        {
            Id = Guid.NewGuid(), OrderId = order.Id, ConfigId = config.Id, DrawnKey = drawn.Key, PrizeKey = prize.Key, PrizeKind = prize.Kind,
            IsFallback = fallbackReason != null, FallbackReason = fallbackReason, PrizeSnapshotJson = JsonSerializer.Serialize(prize, Json),
            Roll = roll, Status = TreasureWinStatus.NoPrize, Email = email, CostIls = cost, IsTest = order.IsTest, CreatedAt = now, UpdatedAt = now,
        };
        if (prize.Kind == TreasureKinds.Percent)
        {
            var coupon = await NewCouponAsync(prize, campaignId, order, now);
            win.CouponId = coupon.Id;
            win.Status = TreasureWinStatus.Coupon;
        }
        else if (prize.Kind == TreasureKinds.Gift && gift != null)
        {
            // the gift is an entitlement of its own, from the existing ownership tables: no order and no payment is invented for it
            var ent = new Entitlement
            {
                Id = Guid.NewGuid(), ProductId = gift.Id, OrderId = null, Source = EntitlementSource.TreasureReward,
                SessionsAllowed = 1, IsTest = order.IsTest, CreatedAt = now,
            };
            db.Entitlements.Add(ent);
            win.EntitlementId = ent.Id;
            win.GiftProductId = gift.Id;
            win.Status = TreasureWinStatus.Gift;
        }
        db.TreasureWins.Add(win);
        return win;
    }

    /// <summary>Whether a prize can be given now: null, or why not ("inactive", "limit", "budget", "no-gift-game"). With its cost.</summary>
    private async Task<(string? Reason, Product? Gift, decimal Cost)> CheckAsync(TreasurePrize prize, Order order, string? email)
    {
        if (prize.Kind == TreasureKinds.None) return (null, null, 0m);
        if (!prize.Active) return ("inactive", null, 0m);
        var given = db.TreasureWins.Where(w => w.PrizeKey == prize.Key && w.Status != TreasureWinStatus.Revoked && w.Status != TreasureWinStatus.NoPrize);
        if (prize.MaxWins is { } max && await given.CountAsync() >= max) return ("limit", null, 0m);

        Product? gift = null;
        decimal cost;
        if (prize.Kind == TreasureKinds.Gift)
        {
            gift = await PickGiftAsync(order, email);
            if (gift == null) return ("no-gift-game", null, 0m);
            cost = gift.PriceIls ?? 0m;
        }
        else
        {
            var top = (await PaidProductsAsync()).Select(p => p.PriceIls ?? 0m).DefaultIfEmpty(0m).Max();
            if (top <= 0) return ("inactive", null, 0m);
            cost = CouponService.Price(top, CouponKind.Percent, prize.DiscountPercent!.Value).Discount;
        }
        if (prize.BudgetIls is { } budget && await given.SumAsync(w => w.CostIls) + cost > budget) return ("budget", null, 0m);
        return (null, gift, cost);
    }

    private async Task<List<Product>> PaidProductsAsync() =>
        (await db.Products.AsNoTracking().Where(p => p.Status == ProductStatus.Published && !p.IsFree && p.PriceIls > 0).ToListAsync())
        .Where(p => PurchaseService.IsPlayable(p, scenarios)).ToList();

    /// <summary>
    /// A random game of the admin's gift list that the buyer does not have yet: never the game just bought, never a game the
    /// same address paid for, never a gift it already got. None left = null (the fallback is used).
    /// </summary>
    private async Task<Product?> PickGiftAsync(Order order, string? email)
    {
        var listed = await db.TreasureGiftProducts.AsNoTracking().Select(g => g.ProductId).ToListAsync();
        var owned = new HashSet<string> { order.ProductId };
        if (email != null)
        {
            owned.UnionWith(await db.Orders.AsNoTracking().Where(o => o.Status == OrderStatus.Paid && o.Email != null && o.Email.ToLower() == email)
                .Select(o => o.ProductId).ToListAsync());
            owned.UnionWith(await db.TreasureWins.AsNoTracking().Where(w => w.Email == email && w.Status == TreasureWinStatus.Gift && w.GiftProductId != null)
                .Select(w => w.GiftProductId!).ToListAsync());
        }
        var options = (await PaidProductsAsync()).Where(p => listed.Contains(p.Id) && !owned.Contains(p.Id)).OrderBy(p => p.Id).ToList();
        return options.Count == 0 ? null : options[System.Security.Cryptography.RandomNumberGenerator.GetInt32(options.Count)];
    }

    /// <summary>A personal coupon in the existing coupon tables: one use, the prize's discount, every paid game, ValidityDays days.</summary>
    private async Task<Coupon> NewCouponAsync(TreasurePrize prize, Guid campaignId, Order order, DateTime now)
    {
        var products = await PaidProductsAsync();
        var id = Guid.NewGuid();
        string code;
        do code = ChallengeRules.NewCode(); while (await db.Coupons.AnyAsync(c => c.Code == code));
        var coupon = new Coupon
        {
            Id = id, Code = code, Name = $"תיבת האוצר · {prize.Name}".Length > 80 ? "תיבת האוצר" : $"תיבת האוצר · {prize.Name}",
            Kind = CouponKind.Percent, Value = prize.DiscountPercent!.Value, StartsAt = now, EndsAt = ChallengeRules.ExpiresAt(now, prize.ValidityDays),
            MaxRedemptions = 1, Active = true, CreatedAt = now, UpdatedAt = now, CampaignId = campaignId,
            // the address is kept on the draw (TreasureWins), not here: one address may win several chests
            Products = products.Select(p => new CouponProduct { CouponId = id, ProductId = p.Id }).ToList(),
        };
        db.Coupons.Add(coupon);
        db.CouponEvents.Add(new CouponEvent
        {
            CouponId = id, Action = "issued", Actor = "system", At = now,
            DetailsJson = JsonSerializer.Serialize(new { source = CampaignKinds.Treasure, orderId = order.Id, discount = coupon.Value, validityDays = prize.ValidityDays }),
        });
        return coupon;
    }

    /// <summary>The one campaign row the treasure coupons belong to (so they are personal coupons, apart from the admin's own).</summary>
    private async Task<Guid> CampaignIdAsync(string anyProductId)
    {
        var id = await db.CouponCampaigns.AsNoTracking().Where(c => c.Kind == CampaignKinds.Treasure).Select(c => (Guid?)c.Id).FirstOrDefaultAsync();
        if (id != null) return id.Value;
        var now = DateTime.UtcNow;
        var c = new CouponCampaign
        {
            Id = Guid.NewGuid(), Kind = CampaignKinds.Treasure, Name = "תיבת האוצר", Description = "פרסי תיבת האוצר אחרי רכישה בתשלום.",
            // the campaign's own discount, validity and game are never read for treasure coupons (each prize has its own)
            IsActive = true, DiscountPercentage = 10, ValidityDays = 30, MaxCoupons = 0, SourceProductId = anyProductId,
            ShowEntryPopup = false, ShowProgress = false, StartedAt = now, CreatedAt = now, UpdatedAt = now,
        };
        db.CouponCampaigns.Add(c);
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException) { db.ChangeTracker.Clear(); }
        db.ChangeTracker.Clear();
        return await db.CouponCampaigns.AsNoTracking().Where(k => k.Kind == CampaignKinds.Treasure).Select(k => k.Id).FirstAsync();
    }

    // ------------------------------------------------------------------ refunds

    /// <summary>
    /// The order was refunded: what its chest gave and was not used yet is taken back (an unredeemed coupon is cancelled, an
    /// unopened gift game is revoked). What was already used stays. Never throws.
    /// </summary>
    public async Task AfterRefundAsync(Guid orderId)
    {
        try
        {
            db.ChangeTracker.Clear();
            var win = await db.TreasureWins.FirstOrDefaultAsync(w => w.OrderId == orderId);
            if (win == null || win.Status is TreasureWinStatus.NoPrize or TreasureWinStatus.Revoked) return;
            var now = DateTime.UtcNow;
            var revoke = false;
            if (win.CouponId is { } cid)
            {
                var redeemed = await db.CouponRedemptions.AnyAsync(r => r.CouponId == cid && r.Status == RedemptionStatus.Redeemed);
                var coupon = await db.Coupons.FirstAsync(c => c.Id == cid);
                if (!redeemed && coupon.CancelledAt == null)
                {
                    coupon.CancelledAt = now;
                    coupon.CancelledBy = "refund";
                    coupon.UpdatedAt = now;
                    db.CouponEvents.Add(new CouponEvent { CouponId = cid, Action = "cancelled", Actor = "system", At = now, DetailsJson = JsonSerializer.Serialize(new { reason = "source-order-refunded", orderId }) });
                    revoke = true;
                }
            }
            if (win.EntitlementId is { } eid)
            {
                var ent = await db.Entitlements.FirstAsync(e => e.Id == eid);
                if (ent.SessionsUsed == 0 && !ent.Revoked)
                {
                    ent.Revoked = true;
                    ent.RevokedAt = now;
                    revoke = true;
                }
            }
            if (revoke)
            {
                win.Status = TreasureWinStatus.Revoked;
                win.RevokedAt = now;
                win.UpdatedAt = now;
            }
            await db.SaveChangesAsync();
        }
        catch (Exception ex) { logger.LogError(ex, "Treasure refund handling for order {Order} failed", orderId); }
        finally { db.ChangeTracker.Clear(); }
    }

    // ------------------------------------------------------------------ the coupon at checkout

    public const string UnboundMessage = "כדי להשתמש בקופון של תיבת האוצר יש לפתוח קודם את התיבה בדף ההזמנה.";
    public const string WrongEmailMessage = "הקופון הזה אישי ותקף רק עם כתובת הדוא״ל שאליה הוא שויך. הזינו בהזמנה את אותה כתובת.";

    /// <summary>
    /// Null unless the coupon is a treasure prize that this order may not use: it belongs to the address it was given to,
    /// so the order must carry that same address (spec: not transferable).
    /// </summary>
    public static async Task<ServiceError?> CouponRefusalAsync(PortalDbContext db, Guid couponId, string? orderEmail)
    {
        var win = await db.TreasureWins.AsNoTracking().Where(w => w.CouponId == couponId).Select(w => new { w.Email }).FirstOrDefaultAsync();
        if (win == null) return null;
        if (win.Email == null) return new ServiceError(409, "treasure-unbound", UnboundMessage);
        if (ResultsEmailService.NormalizeEmail(orderEmail) != win.Email) return new ServiceError(403, "treasure-email", WrongEmailMessage);
        return null;
    }

    // ------------------------------------------------------------------ the buyer's view

    /// <summary>The chest of an order as its buyer sees it. The prize itself is there only once the chest was opened.</summary>
    public async Task<object> ViewAsync(Order order)
    {
        var win = await EnsureDrawAsync(order.Id);
        if (win == null) return new { state = "none" };
        var prize = JsonSerializer.Deserialize<TreasurePrize>(win.PrizeSnapshotJson, Json)!;
        var hasPrize = win.PrizeKind != TreasureKinds.None;
        return new
        {
            state = "drawn",
            hasPrize,
            revealed = win.RevealedAt != null,
            surprise = TreasureRules.SurpriseTitle,
            animation = prize.Animation,
            // a coupon is bound to an address before its code is shown
            needsEmail = win.PrizeKind == TreasureKinds.Percent && win.Email == null,
            prize = win.RevealedAt == null && hasPrize ? null : await PrizeViewAsync(win, prize),
        };
    }

    private async Task<object> PrizeViewAsync(TreasureWin win, TreasurePrize prize)
    {
        var now = DateTime.UtcNow;
        object? coupon = null, gift = null;
        if (win.CouponId is { } cid)
        {
            var k = await db.Coupons.AsNoTracking().FirstAsync(c => c.Id == cid);
            var redeemed = await db.CouponRedemptions.AnyAsync(r => r.CouponId == cid && r.Status == RedemptionStatus.Redeemed);
            coupon = new
            {
                k.Code, percent = k.Value, expiresAt = k.EndsAt, expiresAtText = ChallengeRules.FormatIsrael(k.EndsAt!.Value),
                status = ChallengeRules.Status(k, redeemed, now), email = win.Email == null ? null : ChallengeRules.MaskEmail(win.Email),
            };
        }
        if (win.EntitlementId is { } eid)
        {
            var ent = await db.Entitlements.AsNoTracking().FirstAsync(e => e.Id == eid);
            var p = await db.Products.AsNoTracking().FirstAsync(x => x.Id == win.GiftProductId);
            var room = await db.Rooms.AsNoTracking().FirstOrDefaultAsync(r => r.EntitlementId == eid);
            gift = new
            {
                productId = p.Id, p.Name, p.Tagline, p.Description, p.CoverImage, p.MinPlayers, p.MaxPlayers,
                status = ent.Revoked ? "revoked" : room == null ? "ready" : room.Phase == RoomPhase.Completed ? "played" : "opened",
                canOpen = !ent.Revoked && (room == null ? ent.SessionsUsed < ent.SessionsAllowed : room.Phase == RoomPhase.Lobby),
                gameCode = room?.Code,
            };
        }
        return new
        {
            key = win.PrizeKey, kind = win.PrizeKind, prize.Name, prize.Title, prize.Message,
            revoked = win.Status == TreasureWinStatus.Revoked, coupon, gift,
        };
    }

    /// <summary>
    /// Opens the chest (once; opening it again only shows it again). A coupon is bound to an address first: the order's, or
    /// the one given now. The prize's email is sent once, when the chest is first opened and an address is known.
    /// </summary>
    public async Task<(object? View, ServiceError? Error)> RevealAsync(Order order, TreasureRevealRequest? req, string siteUrl)
    {
        var win = await EnsureDrawAsync(order.Id);
        if (win == null) return (null, new ServiceError(404, "no-treasure", "לרכישה הזאת אין תיבת אוצר."));
        var now = DateTime.UtcNow;
        if (win.PrizeKind == TreasureKinds.Percent && win.Email == null)
        {
            var email = ResultsEmailService.NormalizeEmail(req?.Email);
            if (email == null)
                return (null, new ServiceError(400, "email-required", "הקופון אישי: הזינו כתובת דוא״ל שאליה הוא ישויך. רק איתה אפשר יהיה להשתמש בו."));
            await db.TreasureWins.Where(w => w.Id == win.Id && w.Email == null).ExecuteUpdateAsync(u => u.SetProperty(w => w.Email, email).SetProperty(w => w.UpdatedAt, now));
        }
        await db.TreasureWins.Where(w => w.Id == win.Id && w.RevealedAt == null).ExecuteUpdateAsync(u => u.SetProperty(w => w.RevealedAt, now).SetProperty(w => w.UpdatedAt, now));
        await SendOnceAsync(win.Id, siteUrl);
        return (await ViewAsync(order), null);
    }

    /// <summary>The prize's email, at most once (claimed atomically; a failure frees it for a later try). Never throws.</summary>
    private async Task SendOnceAsync(Guid winId, string siteUrl)
    {
        try
        {
            var win = await db.TreasureWins.AsNoTracking().FirstAsync(w => w.Id == winId);
            if (win.Email == null || win.PrizeKind == TreasureKinds.None || win.Status == TreasureWinStatus.Revoked || win.EmailSentAt != null) return;
            if (!await sender.IsAvailableAsync()) return;
            var now = DateTime.UtcNow;
            if (await db.TreasureWins.Where(w => w.Id == winId && w.EmailSentAt == null).ExecuteUpdateAsync(u => u.SetProperty(w => w.EmailSentAt, now)) == 0) return;
            var prize = JsonSerializer.Deserialize<TreasurePrize>(win.PrizeSnapshotJson, Json)!;
            var order = await db.Orders.AsNoTracking().FirstAsync(o => o.Id == win.OrderId);
            var coupon = win.CouponId == null ? null : await db.Coupons.AsNoTracking().FirstAsync(c => c.Id == win.CouponId);
            var gift = win.GiftProductId == null ? null : await db.Products.AsNoTracking().Where(p => p.Id == win.GiftProductId).Select(p => p.Name).FirstAsync();
            var model = new TreasureEmailModel(prize.Title, coupon?.Code, coupon?.Value, coupon?.EndsAt, gift, (site.SiteUrl ?? siteUrl).TrimEnd('/') + $"/checkout/{order.Id}");
            try
            {
                await sender.SendAsync(new EmailMessage(win.Email, TreasureEmailTemplate.Subject, TreasureEmailTemplate.Html(model), TreasureEmailTemplate.Text(model)));
                logger.LogInformation("Treasure email sent for draw {Win}", winId);
            }
            catch (EmailSendException ex)
            {
                logger.LogWarning("Treasure email for draw {Win} failed: {Code}", winId, ex.Code);
                if (!ex.Uncertain) await db.TreasureWins.Where(w => w.Id == winId).ExecuteUpdateAsync(u => u.SetProperty(w => w.EmailSentAt, (DateTime?)null));
            }
        }
        catch (Exception ex) { logger.LogError(ex, "Treasure email for draw {Win} failed", winId); }
    }

    /// <summary>The gift game's entitlement, if this order won one (for opening it through the existing game flow).</summary>
    public Task<Guid?> GiftEntitlementAsync(Guid orderId) =>
        db.TreasureWins.AsNoTracking().Where(w => w.OrderId == orderId && w.EntitlementId != null && w.RevealedAt != null).Select(w => w.EntitlementId).FirstOrDefaultAsync();
}
