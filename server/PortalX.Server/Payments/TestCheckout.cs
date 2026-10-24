using Microsoft.EntityFrameworkCore;
using PortalX.Server.Content;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;

namespace PortalX.Server.Payments;

/// <summary>
/// Demo checkout: opens a paid game without any payment, for testing the games while no payment provider is connected.
/// It is decided only on the server, by two settings that must both be set — PAYMENTS_MODE=Test and
/// ENABLE_TEST_CHECKOUT=true — and is off when either is missing (the production default).
/// It never creates an order or revenue: the game gets its own entitlement marked as a test, kept apart from purchases.
/// </summary>
public sealed class TestCheckout(bool enabled)
{
    public const string AccessSource = "test-checkout";
    public const string OpenedMessage = "המשחק נפתח במצב הדגמה. לא בוצע חיוב.";
    public const string OffMessage = "מצב הדגמה אינו פעיל באתר.";

    public bool Enabled { get; } = enabled;

    public static TestCheckout FromConfig(IConfiguration config, ILogger logger)
    {
        var mode = config["PAYMENTS_MODE"]?.Trim();
        var show = config["ENABLE_TEST_CHECKOUT"]?.Trim();
        var enabled = string.Equals(mode, "Test", StringComparison.OrdinalIgnoreCase)
            && string.Equals(show, "true", StringComparison.OrdinalIgnoreCase);
        if (enabled)
            logger.LogWarning("DEMO CHECKOUT is on (PAYMENTS_MODE=Test, ENABLE_TEST_CHECKOUT=true): paid games can be opened without payment. Nothing counts as revenue.");
        return new TestCheckout(enabled);
    }

    /// <summary>A paid game that can be opened in demo mode: published, with content, and not the free game.</summary>
    public bool Offers(Product p, ScenarioCatalog scenarios) =>
        Enabled && !p.IsFree && p.Status == ProductStatus.Published && PurchaseService.IsPlayable(p, scenarios);
}

public static class TestCheckoutEndpoints
{
    public static void MapTestCheckout(this RouteGroupBuilder api)
    {
        // opens one game of the chosen product only; refused outright while demo mode is off
        api.MapPost("/products/{id}/test-game", async (string id, TestCheckout test, PortalDbContext db, ScenarioCatalog scenarios,
            RoomService rooms, ILoggerFactory logs) =>
        {
            if (!test.Enabled) return Results.Json(new ApiError("test-checkout-off", TestCheckout.OffMessage), statusCode: 403);
            var product = await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id);
            if (product == null || product.Status != ProductStatus.Published)
                return Results.NotFound(new ApiError("no-product", "המשחק לא נמצא."));
            if (product.IsFree) return Results.Json(new ApiError("free-game", "המשחק הזה חינמי — אפשר לפתוח אותו בלי מצב הדגמה."), statusCode: 409);
            if (!test.Offers(product, scenarios)) return Results.Json(new ApiError("not-available", "המשחק עדיין לא זמין."), statusCode: 409);

            var ent = new Entitlement
            {
                Id = Guid.NewGuid(), ProductId = product.Id, Source = EntitlementSource.TestCheckout,
                SessionsAllowed = 1, SessionsUsed = 1, IsTest = true, CreatedAt = DateTime.UtcNow,
            };
            db.Entitlements.Add(ent);
            await db.SaveChangesAsync();
            var (room, claim) = await rooms.CreateRoomAsync(product.ScenarioId!, r =>
            {
                r.ProductId = product.Id;
                r.EntitlementId = ent.Id;
                r.AccessSource = TestCheckout.AccessSource;
                r.MaxPlayers = rooms.Engine.MaxPlayersFor(product.MaxPlayers);
            });
            logs.CreateLogger("TestCheckout").LogInformation("Demo game {Code} opened for {Product} (no payment)", room.Code, product.Id);
            return Results.Ok(new { code = room.Code, hostClaim = claim, message = TestCheckout.OpenedMessage, test = true });
        }).RequireRateLimiting("test-game");
    }
}
