using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Payments;

namespace PortalX.Tests;

/// <summary>Buys a game through the sandbox provider, the only way a group game can be opened.</summary>
public static class TestPurchase
{
    /// <summary>A priced copy of the original game, so tests never change the real catalog rows.</summary>
    public const string ProductId = "test-portal";
    public const decimal Price = 50m;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static async Task EnsureProductAsync(IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
        if (await db.Products.AnyAsync(p => p.Id == ProductId)) return;
        db.Products.Add(new Product
        {
            Id = ProductId, Name = "מוצר בדיקה", PriceIls = Price, Status = ProductStatus.Published,
            ScenarioId = "last-portal", MinPlayers = 4, MaxPlayers = 8, SortOrder = 99,
            CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        });
        try { await db.SaveChangesAsync(); } catch (DbUpdateException) { /* created by a parallel test */ }
    }

    public sealed record Purchase(Guid OrderId, string Key, string Session, long Number);

    public static async Task<Purchase> CreateOrderAsync(HttpClient http, IServiceProvider services, string productId = ProductId, string? email = null)
    {
        await EnsureProductAsync(services);
        var res = await http.PostAsJsonAsync("/api/orders", new { productId, email });
        res.EnsureSuccessStatusCode();
        var o = await res.Content.ReadFromJsonAsync<JsonElement>(Json);
        var url = o.GetProperty("checkoutUrl").GetString()!;
        return new Purchase(o.GetProperty("orderId").GetGuid(), o.GetProperty("accessKey").GetString()!, url[(url.LastIndexOf('/') + 1)..], o.GetProperty("number").GetInt64());
    }

    public static Task<HttpResponseMessage> PayAsync(HttpClient http, Purchase p, string outcome = "approve") =>
        http.PostAsJsonAsync($"/api/sandbox/checkout/{p.Session}", new { outcome });

    public static HttpRequestMessage WithKey(HttpMethod method, string url, string key)
    {
        var req = new HttpRequestMessage(method, url);
        req.Headers.Add(PurchaseEndpoints.OrderKeyHeader, key);
        return req;
    }

    public static async Task<JsonElement> OrderAsync(HttpClient http, Purchase p) =>
        await (await http.SendAsync(WithKey(HttpMethod.Get, $"/api/orders/{p.OrderId}", p.Key))).Content.ReadFromJsonAsync<JsonElement>(Json);

    public static Task<HttpResponseMessage> OpenGameAsync(HttpClient http, Purchase p) =>
        http.SendAsync(WithKey(HttpMethod.Post, $"/api/orders/{p.OrderId}/game", p.Key));

    /// <summary>Order → sandbox approval → open game. Returns the room code and the host claim.</summary>
    public static async Task<(string Code, string HostClaim)> PaidRoomAsync(HttpClient http, IServiceProvider services, string productId = ProductId)
    {
        var p = await CreateOrderAsync(http, services, productId);
        (await PayAsync(http, p)).EnsureSuccessStatusCode();
        var res = await OpenGameAsync(http, p);
        res.EnsureSuccessStatusCode();
        var g = await res.Content.ReadFromJsonAsync<JsonElement>(Json);
        return (g.GetProperty("code").GetString()!, g.GetProperty("hostClaim").GetString()!);
    }
}
