using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using PortalX.Server.Content;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;

namespace PortalX.Server.Payments;

public sealed record ServiceError(int Status, string Code, string Message);

public sealed record CreatedOrder(Order Order, string AccessKey, string CheckoutUrl);

public sealed record OpenedGame(string Code, string? HostClaim, bool Existing);

public enum WebhookStatus { Ok, Unauthorized, BadRequest, NotFound }

public sealed record WebhookOutcome(WebhookStatus Status, string Result);

/// <summary>
/// Guest checkout (spec §7, Part E): orders with a server-side price snapshot, verified payment notifications,
/// one entitlement per paid order, and opening one group game per entitlement.
/// </summary>
public sealed class PurchaseService(
    PortalDbContext db, PaymentGateway gateway, ScenarioCatalog scenarios, RoomService rooms, CouponService coupons,
    IHostEnvironment env, ILogger<PurchaseService> logger)
{
    public static bool IsPlayable(Product p, ScenarioCatalog scenarios) => p.ScenarioId != null && scenarios.Find(p.ScenarioId) != null;

    public static bool IsPurchasable(Product p, ScenarioCatalog scenarios, PaymentGateway gateway) =>
        p.Status == ProductStatus.Published && !p.IsFree && p.PriceIls is > 0 && IsPlayable(p, scenarios) && gateway.Available
        && SaleWindow.State(p, DateTime.UtcNow) == SaleWindow.Open;

    // ------------------------------------------------------------------ orders

    public async Task<(CreatedOrder? Created, ServiceError? Error)> CreateOrderAsync(string? productId, string? email, string? couponCode = null,
        Guid? referralLinkId = null, bool adminTrial = false)
    {
        var product = await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == (productId ?? ""));
        if (product == null || product.Status != ProductStatus.Published)
            return (null, new ServiceError(404, "no-product", "המשחק לא נמצא."));
        if (product.IsFree)
            return (null, new ServiceError(409, "free-product", "המשחק הזה חינמי — אין צורך ברכישה."));
        // the opening time (Israel time) and a manual pause are checked here, whatever the page showed
        // only the admin's own trial purchase passes a paused sale; the sale itself stays exactly as it is
        if (!adminTrial && SaleWindow.Refusal(product, DateTime.UtcNow) is { } closed) return (null, closed);
        if (product.PriceIls is not > 0)
            return (null, new ServiceError(409, "no-price", "המחיר של המשחק הזה טרם נקבע, ולכן אי אפשר לרכוש אותו עדיין."));
        if (!IsPlayable(product, scenarios))
            return (null, new ServiceError(409, "not-available", "המשחק עדיין לא זמין לרכישה."));
        if (gateway.Provider is not { } provider)
            return (null, new ServiceError(503, "payments-unavailable", "התשלום באתר עדיין לא פתוח. נסו שוב מאוחר יותר."));

        email = string.IsNullOrWhiteSpace(email) ? null : email.Trim();
        if (email != null && (email.Length > 200 || !MailAddress.TryCreate(email, out _)))
            return (null, new ServiceError(400, "bad-email", "כתובת הדוא״ל אינה תקינה. אפשר גם להשאיר את השדה ריק."));

        var key = RoomService.NewToken();
        var now = DateTime.UtcNow;
        // the discount is computed here from the catalog price and the coupon — never taken from the browser
        CouponQuote? quote = null;
        if (!string.IsNullOrWhiteSpace(couponCode))
        {
            var (q, qErr) = await coupons.QuoteAsync(couponCode, product, now);
            if (qErr != null) return (null, qErr);
            quote = q;
        }
        var order = new Order
        {
            Id = Guid.NewGuid(),
            ProductId = product.Id,
            ProductName = product.Name,
            // the price always comes from the catalog at this moment, never from the browser
            PriceSnapshot = quote?.FinalPrice ?? product.PriceIls.Value,
            OriginalPrice = product.PriceIls.Value,
            DiscountAmount = quote?.Discount ?? 0,
            CouponCode = quote?.Code,
            CouponId = quote?.CouponId,
            Currency = product.Currency,
            Status = OrderStatus.Pending,
            Provider = provider.Name,
            IsTest = provider.IsTest,
            Email = email,
            AccessKeyHash = RoomService.Hash(key),
            CreatedAt = now,
            UpdatedAt = now,
            // the visit's personal link, fixed now: the provider's return can never change it
            ReferralLinkId = referralLinkId,
            ReferralAttributedAt = referralLinkId == null ? null : now,
        };
        order.ProviderSessionId = provider.NewSessionId();
        order.CheckoutExpiresAt = now + provider.CheckoutLifetime;
        // the order and its coupon use are saved together; the database retry strategy re-runs the whole unit
        ServiceError? reserveError = null;
        await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            reserveError = null;
            await using var tx = await db.Database.BeginTransactionAsync();
            db.Orders.Add(order);
            if (quote != null && (reserveError = await coupons.ReserveAsync(quote, order, now)) != null)
            {
                await tx.RollbackAsync();
                return;
            }
            await db.SaveChangesAsync();
            await tx.CommitAsync();
        });
        if (reserveError != null)
        {
            db.ChangeTracker.Clear();
            return (null, reserveError);
        }
        logger.LogInformation("Order {Number} created for {Product} ({Price} {Currency}, provider {Provider})",
            order.Number, product.Id, order.PriceSnapshot, order.Currency, provider.Name);
        // the order is saved first, so a payment can never arrive for an order the server does not know
        try
        {
            var checkout = await provider.CreateCheckoutAsync(order);
            return (new CreatedOrder(order, key, checkout.CheckoutUrl), null);
        }
        catch (PaymentStartException ex)
        {
            logger.LogWarning("Order {Number}: the payment page did not open: {Reason}", order.Number, ex.Message);
            order.Status = OrderStatus.Failed;
            order.FailedAt = DateTime.UtcNow;
            order.UpdatedAt = order.FailedAt.Value;
            await coupons.UpdateForOrderAsync(order.Id, order.Status, order.UpdatedAt);
            await db.SaveChangesAsync();
            return (null, new ServiceError(502, "payment-start-failed", "לא הצלחנו לפתוח את דף התשלום. לא בוצע חיוב. נסו שוב בעוד רגע."));
        }
    }

    /// <summary>The order, if the key matches. Only the buyer holds the key.</summary>
    public async Task<Order?> FindOrderAsync(Guid id, string? key)
    {
        if (string.IsNullOrEmpty(key)) return null;
        var order = await db.Orders.AsNoTracking().FirstOrDefaultAsync(o => o.Id == id);
        if (order == null) return null;
        var ok = CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(order.AccessKeyHash), Encoding.ASCII.GetBytes(RoomService.Hash(key)));
        return ok ? order : null;
    }

    public async Task<object> OrderViewAsync(Order order)
    {
        var ent = await db.Entitlements.AsNoTracking().FirstOrDefaultAsync(e => e.OrderId == order.Id);
        var room = ent == null ? null : await db.Rooms.AsNoTracking().Include(r => r.Players).FirstOrDefaultAsync(r => r.EntitlementId == ent.Id);
        var product = await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == order.ProductId);
        var blocked = ent == null ? null : GameBlock(ent, product);
        return new
        {
            order.Id, order.Number, order.ProductId, order.ProductName, order.Provider,
            Price = order.PriceSnapshot, order.Currency,
            order.OriginalPrice, Discount = order.DiscountAmount, order.CouponCode,
            Status = order.Status.ToString().ToLowerInvariant(),
            order.IsTest, order.CreatedAt, order.PaidAt,
            EmailOnFile = order.Email != null,
            MaxPlayers = product?.MaxPlayers ?? 4,
            Game = room == null ? null : new
            {
                room.Code,
                Phase = room.Phase.ToString().ToLowerInvariant(),
                PlayerCount = room.Players.Count(p => !p.IsRemoved),
            },
            CanOpenGame = order.Status == OrderStatus.Paid && blocked == null
                && (room == null ? ent!.SessionsUsed < ent.SessionsAllowed : room.Phase == RoomPhase.Lobby),
            GameBlockedReason = order.Status == OrderStatus.Paid ? blocked?.Message : null,
            // the payment arrived after this coupon's limit was reached: it will be refunded by hand
            PaymentNeedsRefund = order.ProviderIssue?.StartsWith("coupon-limit:") == true,
        };
    }

    // ------------------------------------------------------------------ payment notifications

    public async Task<WebhookOutcome> HandleWebhookAsync(string providerName, string body, IHeaderDictionary headers)
    {
        if (gateway.Provider is not { } provider || provider.Name != providerName)
            return new WebhookOutcome(WebhookStatus.NotFound, "unknown-provider");
        PaymentNotification n;
        try
        {
            n = provider.ParseWebhook(body, headers);
        }
        catch (InvalidWebhookException ex)
        {
            logger.LogWarning("Rejected {Provider} webhook: {Reason}", providerName, ex.Message);
            return new WebhookOutcome(ex.Message == "bad signature" ? WebhookStatus.Unauthorized : WebhookStatus.BadRequest, ex.Message);
        }
        return new WebhookOutcome(WebhookStatus.Ok, await ApplyAsync(provider, n));
    }

    /// <summary>Applies a verified notification exactly once. Returns what happened (also stored on the event).</summary>
    public Task<string> ApplyAsync(IPaymentProvider provider, PaymentNotification n) => ApplyAsync(provider.Name, provider.IsTest, n);

    /// <summary>The admin records a refund made at the provider. The order, its game and its results all stay on record.</summary>
    public async Task<(bool Ok, string Result)> MarkRefundedAsync(Guid orderId)
    {
        var order = await db.Orders.AsNoTracking().FirstOrDefaultAsync(o => o.Id == orderId);
        if (order == null) return (false, "no-order");
        if (order.Status != OrderStatus.Paid) return (false, "not-paid");
        var result = await ApplyAsync(order.Provider, order.IsTest, new PaymentNotification(
            $"admin-refund:{order.Id}", PaymentEventType.Refunded, order.ProviderSessionId ?? "", order.Id, order.ProviderTransactionId,
            order.PriceSnapshot, order.Currency, order.IsTest, Source: "admin"));
        return (result == "applied:refunded", result);
    }

    /// <summary>The game of this order, if it has one that has not finished.</summary>
    public async Task<Guid?> OpenRoomOfOrderAsync(Guid orderId) =>
        await db.Rooms.AsNoTracking().Where(r => r.Phase != RoomPhase.Completed && db.Entitlements.Any(e => e.OrderId == orderId && e.Id == r.EntitlementId))
            .Select(r => (Guid?)r.Id).FirstOrDefaultAsync();

    private async Task<string> ApplyAsync(string providerName, bool providerIsTest, PaymentNotification n)
    {
        var evt = new PaymentEvent
        {
            Provider = providerName, ProviderEventId = n.EventId, OrderId = n.OrderId,
            Type = n.Type.ToString().ToLowerInvariant(), Amount = n.Amount, Currency = n.Currency,
            ProviderTransactionId = n.TransactionId, IsTest = n.IsTest, Result = "received", Source = n.Source, ReceivedAt = DateTime.UtcNow,
        };
        db.PaymentEvents.Add(evt);
        var resumed = false;
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            db.ChangeTracker.Clear();
            var earlier = await db.PaymentEvents.AsNoTracking().FirstAsync(e => e.Provider == providerName && e.ProviderEventId == n.EventId);
            // an earlier attempt that never finished (a crash after saving the event) must not block this payment for good
            if (earlier.Result is not ("received" or RetryExhausted))
            {
                logger.LogInformation("Duplicate {Provider} event {Event} ignored", providerName, n.EventId);
                return "duplicate";
            }
            evt = earlier;
            resumed = true;
        }

        string result = RetryExhausted;
        for (var attempt = 0; attempt < 4; attempt++)
        {
            db.ChangeTracker.Clear();
            try
            {
                result = await TransitionAsync(providerName, providerIsTest, n);
                break;
            }
            catch (DbUpdateException ex) when (ex is DbUpdateConcurrencyException || IsUniqueViolation(ex))
            {
                // another notification for the same order was applied at the same moment: re-read and re-check
            }
        }
        db.ChangeTracker.Clear();
        // the other attempt finished at the same moment and its result stands
        if (resumed && result.StartsWith("ignored")) return "duplicate";
        var firstResult = result;
        await db.PaymentEvents.Where(e => e.Id == evt.Id && (firstResult.StartsWith("applied") || e.Result == "received"))
            .ExecuteUpdateAsync(s => s.SetProperty(e => e.Result, firstResult));
        if (result.StartsWith("rejected")) logger.LogWarning("Payment event {Event} for order {Order}: {Result}", n.EventId, n.OrderId, result);
        else logger.LogInformation("Payment event {Event} for order {Order}: {Result}", n.EventId, n.OrderId, result);
        return result;
    }

    private const string RetryExhausted = "rejected:retry-exhausted";

    private async Task<string> TransitionAsync(string providerName, bool providerIsTest, PaymentNotification n)
    {
        var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == n.OrderId);
        if (order == null) return "rejected:unknown-order";
        if (order.Provider != providerName) return "rejected:provider-mismatch";
        if (order.ProviderSessionId != n.SessionId) return "rejected:session-mismatch";
        if (!string.Equals(n.Currency, order.Currency, StringComparison.OrdinalIgnoreCase)) return "rejected:currency-mismatch";
        if (n.IsTest != providerIsTest || n.IsTest != order.IsTest) return "rejected:test-flag-mismatch";
        var amountOk = n.Type == PaymentEventType.Refunded ? n.Amount > 0 && n.Amount <= order.PriceSnapshot : n.Amount == order.PriceSnapshot;
        if (!amountOk) return "rejected:amount-mismatch";

        var now = DateTime.UtcNow;
        string result;
        switch (n.Type)
        {
            // the buyer paid twice for one order: one game only, and the admin is told to refund the second payment
            case PaymentEventType.Succeeded when n.Verified != null && order.Status is OrderStatus.Paid or OrderStatus.Refunded
                    && n.TransactionId != order.ProviderTransactionId:
                order.ProviderIssue = "second-payment:" + n.TransactionId;
                result = "flagged:second-payment";
                break;
            case PaymentEventType.Succeeded when order.Status is OrderStatus.Pending or OrderStatus.Failed or OrderStatus.Cancelled:
                // the coupon's limit is never passed: no game opens, and the admin is told to refund this payment
                if (n.Verified != null && !await coupons.ClaimForPaymentAsync(order.Id, now))
                {
                    order.ProviderIssue = "coupon-limit:" + n.TransactionId;
                    result = "flagged:coupon-limit";
                    break;
                }
                order.Status = OrderStatus.Paid;
                order.PaidAt = now;
                order.ProviderTransactionId = n.TransactionId;
                if (n.Verified is { } verified)
                {
                    order.PaymentVerifiedAt = now;
                    order.ProviderCustomerId = verified.CustomerId;
                    order.ProviderDocumentId = verified.DocumentId;
                    order.ProviderAuthNumber = verified.AuthNumber;
                    if (verified.DocumentId is not > 0) order.ProviderIssue = "document-missing";
                }
                if (!await db.Entitlements.AnyAsync(e => e.OrderId == order.Id))
                    db.Entitlements.Add(new Entitlement
                    {
                        Id = Guid.NewGuid(), ProductId = order.ProductId, OrderId = order.Id, Source = EntitlementSource.Purchase,
                        SessionsAllowed = 1, IsTest = order.IsTest, CreatedAt = now,
                    });
                // a purchase by the link's own owner stays a sale, but never counts for the link
                if (order.ReferralLinkId is { } linkId && order.ReferralExclusion == null)
                {
                    var linkEmail = await db.ReferralLinks.Where(l => l.Id == linkId).Select(l => l.Email).FirstOrDefaultAsync();
                    if (linkEmail != null) order.ReferralExclusion = PortalX.Server.Referrals.ReferralService.ExclusionFor(order.Email, linkEmail);
                }
                result = "applied:paid";
                break;
            case PaymentEventType.Failed when order.Status == OrderStatus.Pending:
                order.Status = OrderStatus.Failed;
                order.FailedAt = now;
                result = "applied:failed";
                break;
            case PaymentEventType.Cancelled when order.Status == OrderStatus.Pending:
                order.Status = OrderStatus.Cancelled;
                order.FailedAt = now;
                result = "applied:cancelled";
                break;
            case PaymentEventType.Refunded when order.Status == OrderStatus.Paid:
                order.Status = OrderStatus.Refunded;
                order.RefundedAt = now;
                order.RefundedAmount = n.Amount;
                foreach (var e in await db.Entitlements.Where(e => e.OrderId == order.Id).ToListAsync())
                {
                    e.Revoked = true;
                    e.RevokedAt = now;
                }
                result = "applied:refunded";
                break;
            default:
                return $"ignored:{n.Type.ToString().ToLowerInvariant()}-while-{order.Status.ToString().ToLowerInvariant()}";
        }
        order.UpdatedAt = now;
        await coupons.UpdateForOrderAsync(order.Id, order.Status, now);
        await db.SaveChangesAsync();
        return result;
    }

    private static bool IsUniqueViolation(DbUpdateException ex) => ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

    // ------------------------------------------------------------------ opening the game

    private ServiceError? GameBlock(Entitlement ent, Product? product)
    {
        if (ent.Revoked) return new ServiceError(403, "revoked", "הרכישה בוטלה או הוחזרה, ולכן אי אפשר לפתוח איתה משחק.");
        if (ent.ExpiresAt is { } exp && exp < DateTime.UtcNow) return new ServiceError(403, "expired", "תוקף הרכישה פג.");
        // test payments never unlock games in production (spec Part E §10)
        if (ent.IsTest && env.IsProduction()) return new ServiceError(403, "test-entitlement", "רכישת בדיקה אינה פותחת משחק באתר הפעיל.");
        if (product == null || !IsPlayable(product, scenarios)) return new ServiceError(409, "not-available", "המשחק עדיין לא זמין.");
        return null;
    }

    /// <summary>
    /// Opens the group game paid for by this order, or returns the one already opened. While that game is still
    /// in the lobby a fresh host claim is issued, so the buyer can always take the host seat again from any device.
    /// </summary>
    public async Task<(OpenedGame? Game, ServiceError? Error)> OpenGameAsync(Guid orderId)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            db.ChangeTracker.Clear();
            var order = await db.Orders.AsNoTracking().FirstAsync(o => o.Id == orderId);
            if (order.Status != OrderStatus.Paid)
                return (null, new ServiceError(409, "not-paid", order.Status == OrderStatus.Pending
                    ? "התשלום עדיין לא אושר. המשחק ייפתח רק אחרי שספק התשלום יאשר אותו לשרת."
                    : "ההזמנה לא שולמה, ולכן אי אפשר לפתוח משחק."));
            var ent = await db.Entitlements.FirstOrDefaultAsync(e => e.OrderId == order.Id);
            if (ent == null) return (null, new ServiceError(409, "no-entitlement", "לא נמצאה זכאות לרכישה הזאת."));
            var product = await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == ent.ProductId);
            if (GameBlock(ent, product) is { } block) return (null, block);

            var existing = await db.Rooms.FirstOrDefaultAsync(r => r.EntitlementId == ent.Id);
            if (existing != null)
            {
                if (existing.Phase != RoomPhase.Lobby) return (new OpenedGame(existing.Code, null, true), null);
                var claim = RoomService.NewToken();
                existing.HostClaimHash = RoomService.Hash(claim);
                existing.UpdatedAt = DateTime.UtcNow;
                await db.SaveChangesAsync();
                return (new OpenedGame(existing.Code, claim, true), null);
            }
            if (ent.SessionsUsed >= ent.SessionsAllowed)
                return (null, new ServiceError(409, "used", "המשחק של הרכישה הזאת כבר נוצל."));

            ent.SessionsUsed++;
            try
            {
                // the entitlement update and the new room are saved together (same DbContext)
                var (room, hostClaim) = await rooms.CreateRoomAsync(product!.ScenarioId!, r =>
                {
                    r.ProductId = product.Id;
                    r.MaxPlayers = rooms.Engine.MaxPlayersFor(product.MaxPlayers);
                    r.EntitlementId = ent.Id;
                    r.AccessSource = ent.Source == EntitlementSource.AdminFree ? "admin-free" : "purchase";
                });
                logger.LogInformation("Order {Number}: game {Code} opened", order.Number, room.Code);
                return (new OpenedGame(room.Code, hostClaim, false), null);
            }
            catch (DbUpdateException ex) when (ex is DbUpdateConcurrencyException || IsUniqueViolation(ex))
            {
                // a second click opened it at the same moment: loop and return that game
            }
        }
        return (null, new ServiceError(409, "busy", "המשחק נפתח כרגע. רעננו את הדף."));
    }
}
