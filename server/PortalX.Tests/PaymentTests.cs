using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Payments;
using static PortalX.Tests.TestPurchase;

namespace PortalX.Tests;

/// <summary>Spec Part I "בדיקות תשלום": guest orders, verified notifications, entitlements, one game per purchase.</summary>
[Collection(DatabaseCollection.Name)]
public class PaymentTests
{
    private readonly HubIntegrationTests.Factory _factory;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public PaymentTests(HubIntegrationTests.Factory factory) => _factory = factory;

    private SandboxPaymentProvider Sandbox => (SandboxPaymentProvider)_factory.Services.GetRequiredService<PaymentGateway>().Provider!;

    private async Task<T> DbAsync<T>(Func<PortalDbContext, Task<T>> f)
    {
        using var scope = _factory.Services.CreateScope();
        return await f(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
    }

    private Task<Order> LoadOrder(Guid id) => DbAsync(db => db.Orders.AsNoTracking().SingleAsync(o => o.Id == id));

    /// <summary>Sends a notification the way the provider would, optionally tampered with after signing.</summary>
    private async Task<HttpResponseMessage> WebhookAsync(HttpClient http, string body, string? signature = null)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/payments/webhook/sandbox") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        req.Headers.Add(SandboxPaymentProvider.SignatureHeader, signature ?? Sandbox.Sign(body));
        return await http.SendAsync(req);
    }

    private async Task<string> SignedBodyAsync(Purchase p, PaymentEventType type, decimal? amount = null)
    {
        var order = await LoadOrder(p.OrderId);
        var body = SandboxPaymentProvider.BuildBody(order, type, "tx_test");
        return amount == null ? body : body.Replace($"\"amount\":{order.PriceSnapshot}", $"\"amount\":{amount}");
    }

    [Fact]
    public async Task Approved_payment_opens_exactly_one_group_game()
    {
        var http = _factory.CreateClient();
        var p = await CreateOrderAsync(http, _factory.Services, email: "buyer@example.com");

        var before = await OrderAsync(http, p);
        Assert.Equal("pending", before.GetProperty("status").GetString());
        Assert.False(before.GetProperty("canOpenGame").GetBoolean());
        Assert.True(before.GetProperty("isTest").GetBoolean());

        (await PayAsync(http, p)).EnsureSuccessStatusCode();
        var after = await OrderAsync(http, p);
        Assert.Equal("paid", after.GetProperty("status").GetString());
        Assert.Equal(Price, after.GetProperty("price").GetDecimal());
        Assert.True(after.GetProperty("canOpenGame").GetBoolean());

        var first = await (await OpenGameAsync(http, p)).Content.ReadFromJsonAsync<JsonElement>(Json);
        var code = first.GetProperty("code").GetString()!;
        Assert.False(first.GetProperty("existing").GetBoolean());

        // opening again returns the same game with a fresh host claim (buyer on another device) — never a second game
        var again = await (await OpenGameAsync(http, p)).Content.ReadFromJsonAsync<JsonElement>(Json);
        Assert.Equal(code, again.GetProperty("code").GetString());
        Assert.True(again.GetProperty("existing").GetBoolean());
        Assert.NotEqual(first.GetProperty("hostClaim").GetString(), again.GetProperty("hostClaim").GetString());

        var ent = await DbAsync(db => db.Entitlements.AsNoTracking().SingleAsync(e => e.OrderId == p.OrderId));
        Assert.Equal(1, ent.SessionsUsed);
        Assert.True(ent.IsTest);
        var room = await DbAsync(db => db.Rooms.AsNoTracking().SingleAsync(r => r.EntitlementId == ent.Id));
        Assert.Equal(ProductId, room.ProductId);
        Assert.Equal("purchase", room.AccessSource);

        var order = await LoadOrder(p.OrderId);
        Assert.Equal("buyer@example.com", order.Email);
        Assert.NotNull(order.ProviderTransactionId);

        var view = await OrderAsync(http, p);
        Assert.Equal(code, view.GetProperty("game").GetProperty("code").GetString());
    }

    [Fact]
    public async Task Two_simultaneous_open_requests_create_one_game()
    {
        var http = _factory.CreateClient();
        var p = await CreateOrderAsync(http, _factory.Services);
        (await PayAsync(http, p)).EnsureSuccessStatusCode();
        var results = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => OpenGameAsync(http, p)));
        var codes = new HashSet<string>();
        foreach (var r in results)
            if (r.IsSuccessStatusCode) codes.Add((await r.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("code").GetString()!);
        Assert.Single(codes);
        Assert.Equal(1, await DbAsync(db => db.Rooms.CountAsync(r => r.Code == codes.First())));
    }

    [Theory]
    [InlineData("decline", "failed")]
    [InlineData("cancel", "cancelled")]
    public async Task Failed_or_cancelled_payment_does_not_open_a_game(string outcome, string status)
    {
        var http = _factory.CreateClient();
        var p = await CreateOrderAsync(http, _factory.Services);
        (await PayAsync(http, p, outcome)).EnsureSuccessStatusCode();

        var view = await OrderAsync(http, p);
        Assert.Equal(status, view.GetProperty("status").GetString());
        Assert.False(view.GetProperty("canOpenGame").GetBoolean());
        var open = await OpenGameAsync(http, p);
        Assert.Equal(HttpStatusCode.Conflict, open.StatusCode);
        Assert.False(await DbAsync(db => db.Entitlements.AnyAsync(e => e.OrderId == p.OrderId)));
    }

    [Fact]
    public async Task Returning_from_the_payment_page_without_server_confirmation_opens_nothing()
    {
        var http = _factory.CreateClient();
        var p = await CreateOrderAsync(http, _factory.Services);
        // the browser comes back to /checkout/{id} but no notification arrived
        var view = await OrderAsync(http, p);
        Assert.Equal("pending", view.GetProperty("status").GetString());
        var open = await OpenGameAsync(http, p);
        Assert.Equal(HttpStatusCode.Conflict, open.StatusCode);
        Assert.Contains("עדיין לא אושר", await open.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Replayed_notification_does_not_create_a_second_entitlement()
    {
        var http = _factory.CreateClient();
        var p = await CreateOrderAsync(http, _factory.Services);
        var body = await SignedBodyAsync(p, PaymentEventType.Succeeded);

        var r1 = await (await WebhookAsync(http, body)).Content.ReadFromJsonAsync<JsonElement>(Json);
        var r2 = await (await WebhookAsync(http, body)).Content.ReadFromJsonAsync<JsonElement>(Json);
        Assert.Equal("applied:paid", r1.GetProperty("result").GetString());
        Assert.Equal("duplicate", r2.GetProperty("result").GetString());

        // a different event confirming the same payment again is ignored too
        var other = await SignedBodyAsync(p, PaymentEventType.Succeeded);
        var r3 = await (await WebhookAsync(http, other)).Content.ReadFromJsonAsync<JsonElement>(Json);
        Assert.Equal("ignored:succeeded-while-paid", r3.GetProperty("result").GetString());

        Assert.Equal(1, await DbAsync(db => db.Entitlements.CountAsync(e => e.OrderId == p.OrderId)));
    }

    [Fact]
    public async Task Unsigned_or_tampered_notifications_are_rejected()
    {
        var http = _factory.CreateClient();
        var p = await CreateOrderAsync(http, _factory.Services);
        var body = await SignedBodyAsync(p, PaymentEventType.Succeeded);

        Assert.Equal(HttpStatusCode.Unauthorized, (await WebhookAsync(http, body, "sha256=00")).StatusCode);
        // signature of the original body, amount changed afterwards
        var tampered = body.Replace($"\"amount\":{Price}", "\"amount\":1");
        Assert.Equal(HttpStatusCode.Unauthorized, (await WebhookAsync(http, tampered, Sandbox.Sign(body))).StatusCode);
        // correctly signed, but for the wrong amount
        var wrongAmount = await SignedBodyAsync(p, PaymentEventType.Succeeded, amount: 1m);
        var r = await (await WebhookAsync(http, wrongAmount)).Content.ReadFromJsonAsync<JsonElement>(Json);
        Assert.Equal("rejected:amount-mismatch", r.GetProperty("result").GetString());
        // unknown provider name
        Assert.Equal(HttpStatusCode.NotFound, (await http.PostAsync("/api/payments/webhook/other", new StringContent(body))).StatusCode);

        Assert.Equal(OrderStatus.Pending, (await LoadOrder(p.OrderId)).Status);
    }

    [Fact]
    public async Task Refund_revokes_the_entitlement()
    {
        var http = _factory.CreateClient();
        var p = await CreateOrderAsync(http, _factory.Services);
        (await PayAsync(http, p)).EnsureSuccessStatusCode();
        var r = await (await WebhookAsync(http, await SignedBodyAsync(p, PaymentEventType.Refunded))).Content.ReadFromJsonAsync<JsonElement>(Json);
        Assert.Equal("applied:refunded", r.GetProperty("result").GetString());

        var order = await LoadOrder(p.OrderId);
        Assert.Equal(OrderStatus.Refunded, order.Status);
        Assert.Equal(Price, order.RefundedAmount);
        Assert.True((await DbAsync(db => db.Entitlements.AsNoTracking().SingleAsync(e => e.OrderId == p.OrderId))).Revoked);
        Assert.Equal(HttpStatusCode.Conflict, (await OpenGameAsync(http, p)).StatusCode);
    }

    [Fact]
    public async Task Price_comes_from_the_catalog_and_is_frozen_on_the_order()
    {
        var http = _factory.CreateClient();
        await EnsureProductAsync(_factory.Services);
        // a price sent by the browser is ignored
        var res = await http.PostAsJsonAsync("/api/orders", new { productId = ProductId, price = 1, amount = 1 });
        var o = await res.Content.ReadFromJsonAsync<JsonElement>(Json);
        var order = await LoadOrder(o.GetProperty("orderId").GetGuid());
        Assert.Equal(Price, order.PriceSnapshot);
        Assert.Equal("ILS", order.Currency);
        Assert.Equal("sandbox", order.Provider);
        Assert.True(order.IsTest);
        Assert.True(order.Number > 1000);
    }

    [Fact]
    public async Task Orders_need_a_priced_playable_product_and_the_right_key()
    {
        var http = _factory.CreateClient();
        Assert.Equal(HttpStatusCode.Conflict, (await http.PostAsJsonAsync("/api/orders", new { productId = "last-portal" })).StatusCode); // no price set
        Assert.Equal(HttpStatusCode.Conflict, (await http.PostAsJsonAsync("/api/orders", new { productId = "hanukkah-oil" })).StatusCode); // not built yet
        Assert.Equal(HttpStatusCode.NotFound, (await http.PostAsJsonAsync("/api/orders", new { productId = "nope" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await http.PostAsJsonAsync("/api/orders", new { productId = ProductId, email = "not-an-email" })).StatusCode);

        var p = await CreateOrderAsync(http, _factory.Services);
        (await PayAsync(http, p)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.NotFound, (await http.SendAsync(WithKey(HttpMethod.Get, $"/api/orders/{p.OrderId}", "wrong"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync($"/api/orders/{p.OrderId}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await http.SendAsync(WithKey(HttpMethod.Post, $"/api/orders/{p.OrderId}/game", "wrong"))).StatusCode);
    }

    [Fact]
    public async Task Free_room_creation_no_longer_exists()
    {
        var http = _factory.CreateClient();
        var res = await http.PostAsJsonAsync("/api/rooms", new { scenarioId = "last-portal" });
        Assert.False(res.IsSuccessStatusCode);
    }

    [Fact]
    public async Task Catalog_reports_purchasability_and_test_mode()
    {
        await EnsureProductAsync(_factory.Services);
        var list = await _factory.CreateClient().GetFromJsonAsync<JsonElement>("/api/products");
        var byId = list.EnumerateArray().ToDictionary(p => p.GetProperty("id").GetString()!);
        Assert.True(byId[ProductId].GetProperty("purchasable").GetBoolean());
        Assert.True(byId[ProductId].GetProperty("testPayments").GetBoolean());
        Assert.False(byId["last-portal"].GetProperty("purchasable").GetBoolean());
        Assert.False(byId["hanukkah-oil"].GetProperty("purchasable").GetBoolean());
    }

    // ------------------------------------------------------------------ production safety

    private sealed class Env(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "PortalX";
        public string ContentRootPath { get; set; } = "";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
    }

    [Fact]
    public void Sandbox_provider_is_refused_in_production()
    {
        var options = new PaymentOptions { Provider = "sandbox" };
        Assert.Null(PaymentGateway.Create(options, new Env("Production"), NullLogger.Instance).Provider);
        Assert.NotNull(PaymentGateway.Create(options, new Env("Staging"), NullLogger.Instance).Provider);
        Assert.Null(PaymentGateway.Create(new PaymentOptions(), new Env("Staging"), NullLogger.Instance).Provider);
    }

    public sealed class ProductionFactory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            var pass = Environment.GetEnvironmentVariable("PORTALX_PG_PASSWORD")
                ?? File.ReadAllText(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PortalX", "pg.pass")).Trim();
            builder.UseEnvironment("Production");
            builder.ConfigureAppConfiguration((_, cfg) => cfg.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = $"Host=localhost;Port=5433;Database=portalx_test;Username=portalx;Password={pass}",
                ["Payments:Provider"] = "sandbox",
                ["RateLimits:CreatePerMinute"] = "100000",
                ["RateLimits:JoinPerMinute"] = "100000",
            }));
        }
    }

    [Fact]
    public async Task In_production_test_payments_are_closed_and_test_purchases_open_nothing()
    {
        // a paid test order made elsewhere (e.g. staging) and present in the same database
        var http = _factory.CreateClient();
        var p = await CreateOrderAsync(http, _factory.Services);
        (await PayAsync(http, p)).EnsureSuccessStatusCode();

        await using var prod = new ProductionFactory();
        var prodHttp = prod.CreateClient();
        var open = await OpenGameAsync(prodHttp, p);
        Assert.Equal(HttpStatusCode.Forbidden, open.StatusCode);
        Assert.Contains("test-entitlement", await open.Content.ReadAsStringAsync());

        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await prodHttp.PostAsJsonAsync("/api/orders", new { productId = ProductId })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await prodHttp.GetAsync($"/api/sandbox/checkout/{p.Session}")).StatusCode);
        var view = await OrderAsync(prodHttp, p);
        Assert.False(view.GetProperty("canOpenGame").GetBoolean());
    }
}
