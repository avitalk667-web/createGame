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
    PortalDbContext db, PaymentGateway gateway, ScenarioCatalog scenarios, RoomService rooms,
    IHostEnvironment env, ILogger<PurchaseService> logger)
{
    public static bool IsPlayable(Product p, ScenarioCatalog scenarios) => p.ScenarioId != null && scenarios.Find(p.ScenarioId) != null;

    public static bool IsPurchasable(Product p, ScenarioCatalog scenarios, PaymentGateway gateway) =>
        p.Status == ProductStatus.Published && p.PriceIls is > 0 && IsPlayable(p, scenarios) && gateway.Available;

    // ------------------------------------------------------------------ orders

    public async Task<(CreatedOrder? Created, ServiceError? Error)> CreateOrderAsync(string? productId, string? email)
    {
        var product = await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == (productId ?? ""));
        if (product == null || product.Status != ProductStatus.Published)
            return (null, new ServiceError(404, "no-product", "המשחק לא נמצא."));
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
        var order = new Order
        {
            Id = Guid.NewGuid(),
            ProductId = product.Id,
            ProductName = product.Name,
            // the price always comes from the catalog at this moment, never from the browser
            PriceSnapshot = product.PriceIls.Value,
            Currency = product.Currency,
            Status = OrderStatus.Pending,
            Provider = provider.Name,
            IsTest = provider.IsTest,
            Email = email,
            AccessKeyHash = RoomService.Hash(key),
            CreatedAt = now,
            UpdatedAt = now,
        };
        var checkout = provider.CreateCheckout(order);
        order.ProviderSessionId = checkout.SessionId;
        db.Orders.Add(order);
        await db.SaveChangesAsync();
        logger.LogInformation("Order {Number} created for {Product} ({Price} {Currency}, provider {Provider})",
            order.Number, product.Id, order.PriceSnapshot, order.Currency, provider.Name);
        return (new CreatedOrder(order, key, checkout.CheckoutUrl), null);
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
            order.Id, order.Number, order.ProductId, order.ProductName,
            Price = order.PriceSnapshot, order.Currency,
            Status = order.Status.ToString().ToLowerInvariant(),
            order.IsTest, order.CreatedAt, order.PaidAt,
            EmailOnFile = order.Email != null,
            MaxPlayers = product?.MaxPlayers ?? 8,
            Game = room == null ? null : new
            {
                room.Code,
                Phase = room.Phase.ToString().ToLowerInvariant(),
                PlayerCount = room.Players.Count(p => !p.IsRemoved),
            },
            CanOpenGame = order.Status == OrderStatus.Paid && blocked == null
                && (room == null ? ent!.SessionsUsed < ent.SessionsAllowed : room.Phase == RoomPhase.Lobby),
            GameBlockedReason = order.Status == OrderStatus.Paid ? blocked?.Message : null,
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
    public async Task<string> ApplyAsync(IPaymentProvider provider, PaymentNotification n)
    {
        var evt = new PaymentEvent
        {
            Provider = provider.Name, ProviderEventId = n.EventId, OrderId = n.OrderId,
            Type = n.Type.ToString().ToLowerInvariant(), Amount = n.Amount, Currency = n.Currency,
            ProviderTransactionId = n.TransactionId, IsTest = n.IsTest, Result = "received", ReceivedAt = DateTime.UtcNow,
        };
        db.PaymentEvents.Add(evt);
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            db.ChangeTracker.Clear();
            logger.LogInformation("Duplicate {Provider} event {Event} ignored", provider.Name, n.EventId);
            return "duplicate";
        }

        string result = "rejected:retry-exhausted";
        for (var attempt = 0; attempt < 4; attempt++)
        {
            db.ChangeTracker.Clear();
            try
            {
                result = await TransitionAsync(provider, n);
                break;
            }
            catch (DbUpdateException ex) when (ex is DbUpdateConcurrencyException || IsUniqueViolation(ex))
            {
                // another notification for the same order was applied at the same moment: re-read and re-check
            }
        }
        db.ChangeTracker.Clear();
        await db.PaymentEvents.Where(e => e.Id == evt.Id).ExecuteUpdateAsync(s => s.SetProperty(e => e.Result, result));
        if (result.StartsWith("rejected")) logger.LogWarning("Payment event {Event} for order {Order}: {Result}", n.EventId, n.OrderId, result);
        else logger.LogInformation("Payment event {Event} for order {Order}: {Result}", n.EventId, n.OrderId, result);
        return result;
    }

    private async Task<string> TransitionAsync(IPaymentProvider provider, PaymentNotification n)
    {
        var order = await db.Orders.FirstOrDefaultAsync(o => o.Id == n.OrderId);
        if (order == null) return "rejected:unknown-order";
        if (order.Provider != provider.Name) return "rejected:provider-mismatch";
        if (order.ProviderSessionId != n.SessionId) return "rejected:session-mismatch";
        if (!string.Equals(n.Currency, order.Currency, StringComparison.OrdinalIgnoreCase)) return "rejected:currency-mismatch";
        if (n.IsTest != provider.IsTest || n.IsTest != order.IsTest) return "rejected:test-flag-mismatch";
        var amountOk = n.Type == PaymentEventType.Refunded ? n.Amount > 0 && n.Amount <= order.PriceSnapshot : n.Amount == order.PriceSnapshot;
        if (!amountOk) return "rejected:amount-mismatch";

        var now = DateTime.UtcNow;
        string result;
        switch (n.Type)
        {
            case PaymentEventType.Succeeded when order.Status is OrderStatus.Pending or OrderStatus.Failed or OrderStatus.Cancelled:
                order.Status = OrderStatus.Paid;
                order.PaidAt = now;
                order.ProviderTransactionId = n.TransactionId;
                if (!await db.Entitlements.AnyAsync(e => e.OrderId == order.Id))
                    db.Entitlements.Add(new Entitlement
                    {
                        Id = Guid.NewGuid(), ProductId = order.ProductId, OrderId = order.Id, Source = EntitlementSource.Purchase,
                        SessionsAllowed = 1, IsTest = order.IsTest, CreatedAt = now,
                    });
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
