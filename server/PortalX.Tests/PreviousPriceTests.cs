using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Admin;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using static PortalX.Tests.TestPurchase;

namespace PortalX.Tests;

/// <summary>
/// The optional previous ("was") price: shown struck through next to the current price, checked against it,
/// stored per game — and never charged: orders and the payment page always use the current price.
/// </summary>
[Collection(DatabaseCollection.Name)]
public class PreviousPriceTests
{
    private const string SaleId = "test-sale";
    private const decimal Now = 68m, Was = 90m;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HubIntegrationTests.Factory _factory;
    public PreviousPriceTests(HubIntegrationTests.Factory factory) => _factory = factory;

    private async Task<HttpClient> AdminClientAsync()
    {
        var http = _factory.CreateClient();
        (await http.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        http.DefaultRequestHeaders.Add(AdminAuth.CsrfHeader, "1");
        return http;
    }

    private async Task<T> DbAsync<T>(Func<PortalDbContext, Task<T>> f)
    {
        using var scope = _factory.Services.CreateScope();
        return await f(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
    }

    /// <summary>A separate priced test game (68 ₪, no previous price), so the real catalog rows are never touched.</summary>
    private async Task ResetSaleProductAsync() => await DbAsync(async db =>
    {
        await db.Products.Where(p => p.Id == SaleId).ExecuteDeleteAsync();
        db.Products.Add(new Product
        {
            Id = SaleId, Name = "מוצר מבצע לבדיקה", PriceIls = Now, Status = ProductStatus.Published,
            ScenarioId = "last-portal", MinPlayers = 1, MaxPlayers = 4, SortOrder = 98,
            CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        });
        return await db.SaveChangesAsync();
    });

    private Task<int> RemoveSaleProductAsync() => DbAsync(db => db.Products.Where(p => p.Id == SaleId).ExecuteDeleteAsync());

    private async Task<JsonElement> PublicAsync(string id) =>
        await _factory.CreateClient().GetFromJsonAsync<JsonElement>($"/api/products/{id}", Json);

    private static decimal? Dec(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDecimal() : null;

    [Fact]
    public async Task Previous_and_current_price_are_both_shown_and_saved_and_reloaded_by_the_admin()
    {
        await ResetSaleProductAsync();
        try
        {
            var admin = await AdminClientAsync();
            var r = await admin.PutAsJsonAsync($"/api/admin/products/{SaleId}", new { previousPriceIls = Was });
            Assert.Equal(HttpStatusCode.OK, r.StatusCode);

            // stored apart from the current price, on this game only
            var row = await DbAsync(db => db.Products.AsNoTracking().SingleAsync(p => p.Id == SaleId));
            Assert.Equal(Now, row.PriceIls);
            Assert.Equal(Was, row.PreviousPriceIls);
            Assert.Null((await DbAsync(db => db.Products.AsNoTracking().SingleAsync(p => p.Id == "hanukkah-oil"))).PreviousPriceIls);

            // loaded back in the admin list for editing
            var list = await admin.GetFromJsonAsync<JsonElement>("/api/admin/products", Json);
            var mine = list.EnumerateArray().Single(p => p.GetProperty("id").GetString() == SaleId);
            Assert.Equal(Was, Dec(mine, "previousPrice"));
            Assert.Equal(Now, Dec(mine, "price"));

            // public game page and catalog show both
            var pub = await PublicAsync(SaleId);
            Assert.Equal(Now, Dec(pub, "price"));
            Assert.Equal(Was, Dec(pub, "previousPrice"));
            var catalog = await _factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/products", Json);
            Assert.Equal(Was, Dec(catalog.EnumerateArray().Single(p => p.GetProperty("id").GetString() == SaleId), "previousPrice"));

            // editing it, then clearing it
            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/products/{SaleId}", new { previousPriceIls = 80m })).StatusCode);
            Assert.Equal(80m, Dec(await PublicAsync(SaleId), "previousPrice"));
            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/products/{SaleId}", new { clearPreviousPrice = true })).StatusCode);
            Assert.Null(Dec(await PublicAsync(SaleId), "previousPrice"));
            Assert.Null((await DbAsync(db => db.Products.AsNoTracking().SingleAsync(p => p.Id == SaleId))).PreviousPriceIls);

            var audit = await admin.GetFromJsonAsync<JsonElement>("/api/admin/audit", Json);
            Assert.Contains(audit.EnumerateArray(), a => a.GetProperty("action").GetString() == "product-price-changed" && a.GetProperty("targetId").GetString() == SaleId);
        }
        finally { await RemoveSaleProductAsync(); }
    }

    [Fact]
    public async Task A_game_without_a_previous_price_shows_only_its_current_price()
    {
        var pub = await PublicAsync("hanukkah-oil");
        Assert.Equal(90m, Dec(pub, "price"));
        Assert.Null(Dec(pub, "previousPrice"));
        var free = await PublicAsync("gate-of-secrets");
        Assert.Null(Dec(free, "previousPrice"));
    }

    [Fact]
    public async Task A_previous_price_at_or_below_the_current_price_is_refused()
    {
        await ResetSaleProductAsync();
        try
        {
            var admin = await AdminClientAsync();
            async Task Bad(string id, object body)
            {
                var res = await admin.PutAsJsonAsync($"/api/admin/products/{id}", body);
                Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
                Assert.False(string.IsNullOrWhiteSpace((await res.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("message").GetString()));
            }
            await Bad(SaleId, new { previousPriceIls = Now });          // equal
            await Bad(SaleId, new { previousPriceIls = 50m });          // lower
            await Bad(SaleId, new { previousPriceIls = -90m });         // not positive
            await Bad(SaleId, new { previousPriceIls = 0m });
            await Bad(SaleId, new { previousPriceIls = 90.555m });      // more than agorot
            await Bad(SaleId, new { priceIls = 95m, previousPriceIls = Was });   // both together, previous below the new current price
            await Bad("gate-of-secrets", new { previousPriceIls = 50m });        // free game: never a previous price
            Assert.Null((await DbAsync(db => db.Products.AsNoTracking().SingleAsync(p => p.Id == SaleId))).PreviousPriceIls);

            // the current price changes later: the stored previous price is checked again
            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/products/{SaleId}", new { previousPriceIls = Was })).StatusCode);
            await Bad(SaleId, new { priceIls = Was });                  // the current price would equal the previous one
            await Bad(SaleId, new { priceIls = 100m });                 // or pass it
            var row = await DbAsync(db => db.Products.AsNoTracking().SingleAsync(p => p.Id == SaleId));
            Assert.Equal(Now, row.PriceIls);
            Assert.Equal(Was, row.PreviousPriceIls);
            // a lower current price keeps the sale valid
            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/products/{SaleId}", new { priceIls = 60m })).StatusCode);

            // and the database itself refuses a previous price that is not above the current one
            await Assert.ThrowsAsync<DbUpdateException>(() => DbAsync(async db =>
            {
                var p = await db.Products.SingleAsync(x => x.Id == SaleId);
                p.PreviousPriceIls = 60m;
                return await db.SaveChangesAsync();
            }));
        }
        finally { await RemoveSaleProductAsync(); }
    }

    [Fact]
    public async Task Payment_always_uses_the_current_price_only()
    {
        await ResetSaleProductAsync();
        try
        {
            var admin = await AdminClientAsync();
            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/products/{SaleId}", new { previousPriceIls = Was })).StatusCode);

            var buyer = _factory.CreateClient();
            var res = await buyer.PostAsJsonAsync("/api/orders", new { productId = SaleId });
            res.EnsureSuccessStatusCode();
            var created = await res.Content.ReadFromJsonAsync<JsonElement>(Json);
            Assert.Equal(Now, created.GetProperty("price").GetDecimal());

            var orderId = created.GetProperty("orderId").GetGuid();
            var order = await DbAsync(db => db.Orders.AsNoTracking().SingleAsync(o => o.Id == orderId));
            Assert.Equal(Now, order.PriceSnapshot);
            Assert.NotEqual(Was, order.OriginalPrice ?? order.PriceSnapshot);

            // the amount on the (sandbox) payment page is the current price
            var url = created.GetProperty("checkoutUrl").GetString()!;
            var page = await buyer.GetFromJsonAsync<JsonElement>($"/api/sandbox/checkout/{url[(url.LastIndexOf('/') + 1)..]}", Json);
            Assert.Equal(Now, page.GetProperty("amount").GetDecimal());

            await DbAsync(db => db.Orders.Where(o => o.Id == orderId).ExecuteDeleteAsync());
        }
        finally { await RemoveSaleProductAsync(); }
    }
}
