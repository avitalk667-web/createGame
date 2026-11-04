using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Admin;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using static PortalX.Tests.TestPurchase;

namespace PortalX.Tests;

/// <summary>Spec Part I "בדיקות מנהל": only the admin sees reports or opens free games; revenue math; product rules.</summary>
[Collection(DatabaseCollection.Name)]
public class AdminTests
{
    // test-only credentials for the test server
    public const string Username = "admin-test";
    public const string Password = "test-admin-password-1234";

    private readonly HubIntegrationTests.Factory _factory;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public AdminTests(HubIntegrationTests.Factory factory) => _factory = factory;

    private async Task<HttpClient> AdminClientAsync()
    {
        var http = _factory.CreateClient();
        var res = await http.PostAsJsonAsync("/api/admin/login", new { username = Username, password = Password });
        res.EnsureSuccessStatusCode();
        http.DefaultRequestHeaders.Add(AdminAuth.CsrfHeader, "1");
        return http;
    }

    private async Task<T> DbAsync<T>(Func<PortalDbContext, Task<T>> f)
    {
        using var scope = _factory.Services.CreateScope();
        return await f(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
    }

    private static async Task<JsonElement> Json200(HttpResponseMessage r)
    {
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return await r.Content.ReadFromJsonAsync<JsonElement>(Json);
    }

    [Theory]
    [InlineData("GET", "/api/admin/me")]
    [InlineData("GET", "/api/admin/dashboard")]
    [InlineData("GET", "/api/admin/orders")]
    [InlineData("GET", "/api/admin/orders.csv")]
    [InlineData("GET", "/api/admin/games")]
    [InlineData("GET", "/api/admin/products")]
    [InlineData("GET", "/api/admin/audit")]
    [InlineData("POST", "/api/admin/sumit/check")]
    [InlineData("PUT", "/api/admin/products/last-portal")]
    public async Task Admin_api_refuses_anyone_without_an_admin_session(string method, string url)
    {
        var http = _factory.CreateClient();
        var req = new HttpRequestMessage(new HttpMethod(method), url);
        req.Headers.Add(AdminAuth.CsrfHeader, "1");
        if (method != "GET") req.Content = JsonContent.Create(new { productId = ProductId, priceIls = 1 });
        // a forged cookie does not help either
        req.Headers.Add("Cookie", "portalx.admin=forged; role=Admin");
        Assert.Equal(HttpStatusCode.Unauthorized, (await http.SendAsync(req)).StatusCode);
    }

    [Fact]
    public async Task Login_logout_and_wrong_password()
    {
        var http = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await http.PostAsJsonAsync("/api/admin/login", new { username = Username, password = "wrong-password-xx" })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await http.PostAsJsonAsync("/api/admin/login", new { username = "someone", password = Password })).StatusCode);
        _factory.Services.GetRequiredService<AdminLoginGuard>().Succeeded("x");

        var admin = await AdminClientAsync();
        var me = await Json200(await admin.GetAsync("/api/admin/me"));
        Assert.Equal(Username, me.GetProperty("name").GetString());
        (await admin.PostAsync("/api/admin/logout", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await admin.GetAsync("/api/admin/me")).StatusCode);

        var audit = await DbAsync(db => db.AdminAuditLog.OrderByDescending(a => a.Id).Take(10).Select(a => a.Action).ToListAsync());
        Assert.Contains("login", audit);
        Assert.Contains("login-failed", audit);
    }

    [Fact]
    public async Task Five_wrong_passwords_lock_the_login()
    {
        var guard = _factory.Services.GetRequiredService<AdminLoginGuard>();
        guard.Succeeded("x");
        var http = _factory.CreateClient();
        try
        {
            for (var i = 0; i < AdminLoginGuard.MaxFailures; i++)
                await http.PostAsJsonAsync("/api/admin/login", new { username = Username, password = "nope-nope-nope" });
            var locked = await http.PostAsJsonAsync("/api/admin/login", new { username = Username, password = Password });
            Assert.Equal(HttpStatusCode.TooManyRequests, locked.StatusCode);
        }
        finally
        {
            guard.Succeeded("x");
        }
    }

    [Fact]
    public async Task State_changes_need_the_admin_header()
    {
        var admin = await AdminClientAsync();
        admin.DefaultRequestHeaders.Remove(AdminAuth.CsrfHeader);
        Assert.Equal(HttpStatusCode.Forbidden, (await admin.PostAsync("/api/admin/sumit/check", null)).StatusCode);
    }

    private static Order RealOrder(OrderStatus status, decimal price, decimal? refunded = null, bool test = false) => new()
    {
        Id = Guid.NewGuid(), ProductId = ProductId, ProductName = "מוצר בדיקה", PriceSnapshot = price, Currency = "ILS",
        Status = status, Provider = test ? "sandbox" : "real-provider", IsTest = test, AccessKeyHash = Guid.NewGuid().ToString("N"),
        ProviderTransactionId = "tx-" + Guid.NewGuid().ToString("N")[..8], CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        PaidAt = DateTime.UtcNow, RefundedAt = refunded != null ? DateTime.UtcNow : null, RefundedAmount = refunded,
    };

    [Fact]
    public async Task Revenue_counts_confirmed_real_payments_minus_refunds_and_never_test_or_free_games()
    {
        await EnsureProductAsync(_factory.Services);
        var admin = await AdminClientAsync();
        var url = $"/api/admin/dashboard?productId={ProductId}";
        var before = (await Json200(await admin.GetAsync(url))).GetProperty("revenue");

        // as if confirmed by a real provider: one paid, one refunded; plus a test payment and a failed one
        await DbAsync(async db =>
        {
            db.Orders.AddRange(RealOrder(OrderStatus.Paid, 50m), RealOrder(OrderStatus.Refunded, 50m, refunded: 50m),
                RealOrder(OrderStatus.Paid, 50m, test: true), RealOrder(OrderStatus.Failed, 50m));
            return await db.SaveChangesAsync();
        });
        var after = (await Json200(await admin.GetAsync(url))).GetProperty("revenue");
        decimal D(JsonElement e, string p) => e.GetProperty(p).GetDecimal();
        Assert.Equal(100m, D(after, "gross") - D(before, "gross"));
        Assert.Equal(50m, D(after, "refunds") - D(before, "refunds"));
        Assert.Equal(50m, D(after, "afterRefunds") - D(before, "afterRefunds"));
        Assert.Equal(2, after.GetProperty("paidCount").GetInt32() - before.GetProperty("paidCount").GetInt32());
    }

    [Fact]
    public async Task The_admin_cannot_open_a_game_without_payment_and_old_free_games_stay_in_the_history()
    {
        await EnsureProductAsync(_factory.Services);
        var admin = await AdminClientAsync();
        var ordersBefore = await DbAsync(db => db.Orders.CountAsync());
        var roomsBefore = await DbAsync(db => db.Rooms.CountAsync());
        var entitlementsBefore = await DbAsync(db => db.Entitlements.CountAsync());
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync("/api/admin/free-game", new { productId = ProductId })).StatusCode);
        Assert.Equal(ordersBefore, await DbAsync(db => db.Orders.CountAsync()));
        Assert.Equal(roomsBefore, await DbAsync(db => db.Rooms.CountAsync()));
        Assert.Equal(entitlementsBefore, await DbAsync(db => db.Entitlements.CountAsync()));

        // a game opened that way in the past is still reported, apart from revenue
        var dashBefore = await Json200(await admin.GetAsync($"/api/admin/dashboard?productId={ProductId}"));
        string code;
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<PortalDbContext>();
            var ent = new Entitlement { Id = Guid.NewGuid(), ProductId = ProductId, Source = EntitlementSource.AdminFree, SessionsAllowed = 1, SessionsUsed = 1, CreatedAt = DateTime.UtcNow };
            db.Entitlements.Add(ent);
            await db.SaveChangesAsync();
            var (room, _) = await scope.ServiceProvider.GetRequiredService<PortalX.Server.Game.RoomService>().CreateRoomAsync("last-portal", r =>
            {
                r.ProductId = ProductId;
                r.EntitlementId = ent.Id;
                r.AccessSource = "admin-free";
            });
            code = room.Code;
        }
        var dashAfter = await Json200(await admin.GetAsync($"/api/admin/dashboard?productId={ProductId}"));
        Assert.Equal(1, dashAfter.GetProperty("games").GetProperty("adminFree").GetInt32() - dashBefore.GetProperty("games").GetProperty("adminFree").GetInt32());
        Assert.Equal(dashBefore.GetProperty("revenue").GetProperty("gross").GetDecimal(), dashAfter.GetProperty("revenue").GetProperty("gross").GetDecimal());
        var row = (await Json200(await admin.GetAsync($"/api/admin/games?search={code}"))).EnumerateArray().Single();
        Assert.Equal("admin-free", row.GetProperty("access").GetString());
        Assert.Equal("מנהל", row.GetProperty("owner").GetString());
        // its host claim can no longer be re-issued
        Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsync($"/api/admin/games/{code}/host-claim", null)).StatusCode);
    }

    [Fact]
    public async Task Product_rules_price_changes_and_audit()
    {
        await EnsureProductAsync(_factory.Services);
        var admin = await AdminClientAsync();
        var buyer = _factory.CreateClient();
        var p = await CreateOrderAsync(buyer, _factory.Services);

        var updated = await Json200(await admin.PutAsJsonAsync($"/api/admin/products/{ProductId}", new { priceIls = 65m }));
        try
        {
            Assert.Equal(65m, updated.GetProperty("price").GetDecimal());
            // an existing order keeps the price it was created with; a new one gets the new price
            Assert.Equal(Price, (await DbAsync(db => db.Orders.AsNoTracking().SingleAsync(o => o.Id == p.OrderId))).PriceSnapshot);
            var p2 = await CreateOrderAsync(buyer, _factory.Services);
            Assert.Equal(65m, (await DbAsync(db => db.Orders.AsNoTracking().SingleAsync(o => o.Id == p2.OrderId))).PriceSnapshot);
            // the other product's price did not change
            Assert.Equal(90m, (await DbAsync(db => db.Products.AsNoTracking().SingleAsync(x => x.Id == "hanukkah-oil"))).PriceIls);

            var audit = await Json200(await admin.GetAsync("/api/admin/audit"));
            Assert.Contains(audit.EnumerateArray(), a => a.GetProperty("action").GetString() == "product-price-changed" && a.GetProperty("targetId").GetString() == ProductId);
        }
        finally
        {
            await admin.PutAsJsonAsync($"/api/admin/products/{ProductId}", new { priceIls = Price });
        }

        async Task Bad(string id, object body) =>
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/admin/products/{id}", body)).StatusCode);
        await Bad("last-portal", new { status = "published" });                    // no price: cannot be published
        await Bad(ProductId, new { clearPrice = true });                            // removing the price of a published product
        await Bad(ProductId, new { priceIls = -5m });
        await Bad(ProductId, new { priceIls = 10.555m });
        await Bad(ProductId, new { maxPlayers = 9 });
        await Bad(ProductId, new { coverImage = "javascript:alert(1)" });
        await Bad(ProductId, new { coverImage = "https://evil.example/x.jpg" });
        Assert.Null((await DbAsync(db => db.Products.AsNoTracking().SingleAsync(x => x.Id == "last-portal"))).PriceIls);
    }

    [Fact]
    public async Task Sales_csv_has_hebrew_headers_and_neutralises_formulas()
    {
        await EnsureProductAsync(_factory.Services);
        var buyer = _factory.CreateClient();
        await CreateOrderAsync(buyer, _factory.Services, email: "=cmd@example.com");
        var admin = await AdminClientAsync();
        var res = await admin.GetAsync($"/api/admin/orders.csv?productId={ProductId}&includeTest=true");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("text/csv", res.Content.Headers.ContentType?.MediaType);
        var bytes = await res.Content.ReadAsByteArrayAsync();
        Assert.True(bytes.AsSpan().StartsWith(Encoding.UTF8.GetPreamble()));
        var text = Encoding.UTF8.GetString(bytes);
        Assert.StartsWith("מספר הזמנה,", text.TrimStart('﻿'));
        Assert.Contains("'=cmd@example.com", text);
        Assert.DoesNotContain(",=cmd@example.com", text);
    }

    [Fact]
    public void Common_paste_mistakes_in_the_dashboard_still_work()
    {
        var hash = AdminAuth.HashPassword("a-long-password-123");
        foreach (var pasted in new[] { $" {hash} ", $"\"{hash}\"", $"'{hash}'", $"{hash}\n", $"{hash[..40]}\n{hash[40..]}", $"“{hash}”" })
        {
            var options = new AdminOptions { Username = " Owner ", PasswordHash = pasted };
            Assert.Equal("ready", AdminAuth.HashStatus(options));
            Assert.True(AdminAuth.Verify(options, "owner", "a-long-password-123"), pasted);
            Assert.True(AdminAuth.Verify(options, "OWNER ", "a-long-password-123"));
            Assert.Equal(AdminAuth.LoginCheck.WrongPassword, AdminAuth.Check(options, "owner", "a-long-password-12"));
            Assert.Equal(AdminAuth.LoginCheck.WrongUser, AdminAuth.Check(options, "someone", "a-long-password-123"));
        }
    }

    [Fact]
    public void Hash_status_explains_a_bad_configuration_without_revealing_it()
    {
        var hash = AdminAuth.HashPassword("a-long-password-123");
        Assert.Equal("not-configured", AdminAuth.HashStatus(new AdminOptions()));
        Assert.StartsWith("invalid", AdminAuth.HashStatus(new AdminOptions { Username = "u", PasswordHash = "not base64!" }));
        Assert.StartsWith("invalid", AdminAuth.HashStatus(new AdminOptions { Username = "u", PasswordHash = hash[..40] })); // cut short
        Assert.StartsWith("invalid", AdminAuth.HashStatus(new AdminOptions { Username = "u", PasswordHash = Convert.ToBase64String(new byte[61]) }));
        Assert.Equal(AdminAuth.LoginCheck.BadHash, AdminAuth.Check(new AdminOptions { Username = "u", PasswordHash = "%%%" }, "u", "x"));
    }

    [Fact]
    public void Password_hash_round_trip()
    {
        var options = new AdminOptions { Username = "owner", PasswordHash = AdminAuth.HashPassword("a-long-password-123") };
        Assert.True(AdminAuth.Verify(options, "owner", "a-long-password-123"));
        Assert.True(AdminAuth.Verify(options, " owner ", "a-long-password-123"));
        Assert.False(AdminAuth.Verify(options, "owner", "a-long-password-124"));
        Assert.False(AdminAuth.Verify(options, "other", "a-long-password-123"));
        Assert.False(AdminAuth.Verify(new AdminOptions(), "", ""));
        Assert.False(AdminAuth.Verify(new AdminOptions { Username = "owner", PasswordHash = "not-a-hash" }, "owner", "x"));
    }
}
