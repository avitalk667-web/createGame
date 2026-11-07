using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using PortalX.Server.Payments;
using PortalX.Server.Security;

namespace PortalX.Server.Content;

public sealed record FaqItem(string Question, string Answer);

/// <summary>Public site endpoints: the FAQ of the home page and starting the free trial game.</summary>
public static class SiteEndpoints
{
    /// <summary>
    /// The questions the site shipped with. They were copied once into the FAQ table (migration SaleOpeningAndFaqImport),
    /// where the admin edits and deletes them like any other question; the site no longer reads them from here.
    /// </summary>
    public static List<FaqItem> LoadFixedFaq() =>
        JsonSerializer.Deserialize<List<FaqItem>>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Content", "faq.he.json")), ScenarioCatalog.JsonOptions)!;

    public static void MapSiteEndpoints(this RouteGroupBuilder api)
    {
        // Every question comes from the database, so the admin's edits and deletions are what the home page shows.
        // Plain text only: the page shows these with text interpolation, so HTML or scripts typed by mistake never run.
        api.MapGet("/faq", async (PortalDbContext db) =>
        {
            var list = await db.Faq.AsNoTracking().Where(f => f.Published).OrderBy(f => f.SortOrder).ThenBy(f => f.CreatedAt).ToListAsync();
            return Results.Ok(list.Select(f => new { id = f.Id.ToString(), question = f.Question, answer = f.Answer }));
        });

        // The free trial game (spec 1.5): no payment, no account, no entitlement — and never revenue.
        api.MapPost("/products/{id}/free-game", async (string id, HttpRequest http, PortalDbContext db, ScenarioCatalog scenarios, RoomService rooms,
            PortalX.Server.Referrals.ReferralService referrals, UsageLimiter limiter, FreeGameReuse reuse, ILoggerFactory logs) =>
        {
            var product = await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id && p.Status == ProductStatus.Published);
            if (product == null) return Results.NotFound(new ApiError("no-product", "המשחק לא נמצא."));
            // only a product marked free can be opened this way; paid games still need a paid order
            if (!product.IsFree) return Results.Json(new ApiError("not-free", "המשחק הזה אינו חינמי. אפשר לרכוש אותו בעמוד המשחק."), statusCode: 403);
            if (!PurchaseService.IsPlayable(product, scenarios)) return Results.Json(new ApiError("not-available", "המשחק עדיין לא זמין."), statusCode: 409);
            if (SaleWindow.Refusal(product, DateTime.UtcNow) is { } closed) return Results.Json(new ApiError(closed.Code, closed.Message), statusCode: closed.Status);

            var ctx = http.HttpContext;
            var browser = BrowserIdentity.Of(ctx);
            var gate = browser != null ? reuse.LockFor(browser) : null;
            if (gate != null) await gate.WaitAsync();
            try
            {
                // the same browser pressing again before its game started (back, refresh, a retry): the same game, not
                // another one, and it is not counted again
                if (browser != null && reuse.Find(browser, product.Id, DateTime.UtcNow) is { } prev)
                {
                    var still = await db.Rooms.AsNoTracking().Where(r => r.Id == prev.RoomId)
                        .Select(r => new { r.Phase, r.FirstStartedAt, r.ProductId }).FirstOrDefaultAsync();
                    if (still != null && still.Phase == RoomPhase.Lobby && still.FirstStartedAt == null && still.ProductId == product.Id)
                        return Results.Ok(new { code = prev.Code, hostClaim = prev.HostClaim });
                    reuse.Forget(browser, product.Id);
                }

                // per browser first, per address only as a looser safety net (many people share one address)
                var v = UsageLimits.FreeGame(ctx, limiter, out var code, out var message);
                if (!v.Allowed)
                {
                    logs.CreateLogger("FreeGame").LogInformation("Free game refused ({Code}) for {Product}", code, product.Id);
                    return UsageLimiter.TooMany(ctx, code, message, v.RetryAfter);
                }

                // the personal link of this visit, read from the server-side visit record (never from the request), kept on the game
                var referral = await referrals.ResolveVisitAsync(http.Cookies[PortalX.Server.Referrals.ReferralService.VisitCookie]);
                var (room, claim) = await rooms.CreateRoomAsync(product.ScenarioId!, r =>
                {
                    r.ProductId = product.Id;
                    r.AccessSource = "free-sample";
                    r.MaxPlayers = rooms.Engine.MaxPlayersFor(product.MaxPlayers);
                    r.ReferralLinkId = referral;
                });
                if (browser != null) reuse.Remember(browser, product.Id, new FreeGameReuse.Opened(room.Id, room.Code, claim, DateTime.UtcNow));
                logs.CreateLogger("FreeGame").LogInformation("Free game {Code} opened for {Product}", room.Code, product.Id);
                return Results.Ok(new { code = room.Code, hostClaim = claim });
            }
            finally
            {
                gate?.Release();
            }
        });
    }
}
