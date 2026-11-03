using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;

namespace PortalX.Server.Content;

public sealed record GalleryImage(string Src, string Caption);

/// <summary>Default catalog rows from Content/products.he.json.</summary>
public sealed class ProductSeed
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Tagline { get; init; }
    public required string Description { get; init; }
    public decimal? PriceIls { get; init; }
    public required string CoverImage { get; init; }
    public List<GalleryImage> Gallery { get; init; } = new();
    public List<string> Features { get; init; } = new();
    public List<string> Included { get; init; } = new();
    [System.Text.Json.Serialization.JsonConverter(typeof(System.Text.Json.Serialization.JsonStringEnumConverter))]
    public ProductStatus Status { get; init; }
    public int MinPlayers { get; init; } = 1;
    public int MaxPlayers { get; init; } = 4;
    public bool IsFree { get; init; }
    public string? ScenarioId { get; init; }
    public int SortOrder { get; init; }

    public static List<ProductSeed> LoadDefault() =>
        JsonSerializer.Deserialize<List<ProductSeed>>(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Content", "products.he.json")), ScenarioCatalog.JsonOptions)!;

    /// <summary>
    /// Inserts products that do not exist yet. Existing rows are left alone, so prices and texts
    /// changed later by the admin are never overwritten on restart.
    /// </summary>
    public static async Task SeedAsync(PortalDbContext db, IEnumerable<ProductSeed> seeds)
    {
        var now = DateTime.UtcNow;
        foreach (var s in seeds)
        {
            if (await db.Products.AnyAsync(p => p.Id == s.Id)) continue;
            db.Products.Add(new Product
            {
                Id = s.Id, Name = s.Name, Tagline = s.Tagline, Description = s.Description,
                PriceIls = s.PriceIls, Currency = "ILS", CoverImage = s.CoverImage,
                GalleryJson = JsonSerializer.Serialize(s.Gallery, ScenarioCatalog.JsonOptions),
                FeaturesJson = JsonSerializer.Serialize(s.Features, ScenarioCatalog.JsonOptions),
                IncludedJson = JsonSerializer.Serialize(s.Included, ScenarioCatalog.JsonOptions),
                Status = s.Status, MinPlayers = s.MinPlayers, MaxPlayers = s.MaxPlayers, IsFree = s.IsFree,
                ScenarioId = s.ScenarioId, SortOrder = s.SortOrder, CreatedAt = now, UpdatedAt = now,
            });
        }
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Text corrections for rows that already exist: each one replaces one exact old line with the new one, only while the old
    /// line is still there, so it runs once and never touches anything the admin wrote. Nothing is deleted.
    /// </summary>
    public static readonly (string ProductId, string Old, string New)[] FeatureFixes =
    [
        // the last portal's card shows its scoring instead of its length
        ("last-portal", "25–35 דקות", "ניקוד אישי וקבוצתי"),
    ];

    public static async Task ApplyFeatureFixesAsync(PortalDbContext db)
    {
        foreach (var (id, oldText, newText) in FeatureFixes)
        {
            var p = await db.Products.FindAsync(id);
            if (p == null) continue;
            var features = JsonSerializer.Deserialize<List<string>>(p.FeaturesJson, ScenarioCatalog.JsonOptions) ?? [];
            var i = features.IndexOf(oldText);
            if (i < 0) continue;
            features[i] = newText;
            p.FeaturesJson = JsonSerializer.Serialize(features, ScenarioCatalog.JsonOptions);
            p.UpdatedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync();
    }
}

/// <summary>Public view of a product for the catalog pages.</summary>
public static class ProductView
{
    public static object Build(Product p, ScenarioCatalog scenarios, Payments.PaymentGateway gateway)
    {
        var playable = Payments.PurchaseService.IsPlayable(p, scenarios);
        return new
        {
            p.Id, p.Name, p.Tagline, p.Description,
            Price = p.PriceIls, p.Currency, p.CoverImage,
            Gallery = JsonNode.Parse(p.GalleryJson),
            Features = JsonNode.Parse(p.FeaturesJson),
            Included = JsonNode.Parse(p.IncludedJson),
            p.MinPlayers, p.MaxPlayers, p.ScenarioId, p.IsFree,
            // the game content exists on the server and can be played
            Playable = playable,
            PriceSet = p.PriceIls is > 0,
            Purchasable = Payments.PurchaseService.IsPurchasable(p, scenarios, gateway),
            PaymentsAvailable = gateway.Available,
            TestPayments = gateway.Provider?.IsTest ?? false,
            // "open", "scheduled" or "paused"; a scheduled game shows its opening time (Israel time)
            SaleState = Payments.SaleWindow.State(p, DateTime.UtcNow),
            SaleOpensAt = p.SaleOpensAt,
            SaleOpensLabel = p.SaleOpensAt is { } at ? Payments.SaleWindow.Label(at) : null,
        };
    }
}
