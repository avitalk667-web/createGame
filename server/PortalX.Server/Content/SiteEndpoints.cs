using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using PortalX.Server.Payments;

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
        api.MapPost("/products/{id}/free-game", async (string id, PortalDbContext db, ScenarioCatalog scenarios, RoomService rooms, ILoggerFactory logs) =>
        {
            var product = await db.Products.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id && p.Status == ProductStatus.Published);
            if (product == null) return Results.NotFound(new ApiError("no-product", "המשחק לא נמצא."));
            // only a product marked free can be opened this way; paid games still need a paid order
            if (!product.IsFree) return Results.Json(new ApiError("not-free", "המשחק הזה אינו חינמי. אפשר לרכוש אותו בעמוד המשחק."), statusCode: 403);
            if (!PurchaseService.IsPlayable(product, scenarios)) return Results.Json(new ApiError("not-available", "המשחק עדיין לא זמין."), statusCode: 409);
            if (SaleWindow.Refusal(product, DateTime.UtcNow) is { } closed) return Results.Json(new ApiError(closed.Code, closed.Message), statusCode: closed.Status);
            var (room, claim) = await rooms.CreateRoomAsync(product.ScenarioId!, r =>
            {
                r.ProductId = product.Id;
                r.AccessSource = "free-sample";
                r.MaxPlayers = rooms.Engine.MaxPlayersFor(product.MaxPlayers);
            });
            logs.CreateLogger("FreeGame").LogInformation("Free game {Code} opened for {Product}", room.Code, product.Id);
            return Results.Ok(new { code = room.Code, hostClaim = claim });
        }).RequireRateLimiting("free-game");
    }
}
