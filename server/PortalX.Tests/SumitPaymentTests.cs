using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using PortalX.Server.Admin;
using PortalX.Server.Content;
using PortalX.Server.Data;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using PortalX.Server.Mail;
using PortalX.Server.Payments;
using PortalX.Server.Referrals;
using static PortalX.Tests.TestPurchase;

namespace PortalX.Tests;

/// <summary>Stands in for api.sumit.co.il: keeps payments in memory and records every call. No test touches the network.</summary>
public sealed class FakeSumit : SumitHttp
{
    public readonly ConcurrentQueue<(string Path, JsonObject Body)> Calls = new();
    public readonly ConcurrentDictionary<long, Dictionary<string, object?>> Payments = new();
    public volatile bool Down;
    public volatile bool RefuseBegin;
    public long DocumentId = 7000;
    // payment numbers stay unique across test runs, because the test database keeps its payment events
    private static long _nextId = DateTime.UtcNow.Ticks / 10_000;

    public override HttpMessageHandler Handler => new H(this);

    public int Count(string path) => Calls.Count(c => c.Path == path);
    public int ReadCalls => Calls.Count(c => !c.Path.Contains("beginredirect") && !c.Path.Contains("companies"));
    public volatile int OrganizationType = 1;
    public volatile int IssuedDocumentType = 2;
    public volatile bool DocumentsDown;

    /// <summary>A payment as SUMIT would hold it. The arguments make it wrong in the ways the tests need.</summary>
    public long Pay(Guid orderId, decimal amount, bool valid = true, object? currency = null, string? external = null, bool withDocument = true)
    {
        var id = Interlocked.Increment(ref _nextId);
        Payments[id] = new()
        {
            ["ID"] = id, ["CustomerID"] = 900, ["ValidPayment"] = valid, ["Status"] = "000", ["Amount"] = amount, ["Currency"] = currency ?? 0,
            ["ExternalIdentifier"] = external ?? orderId.ToString(), ["DocumentID"] = withDocument ? Interlocked.Increment(ref DocumentId) : 0, ["AuthNumber"] = "A1",
        };
        return id;
    }

    private sealed class H(FakeSumit s) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var path = request.RequestUri!.AbsolutePath;
            var body = JsonNode.Parse(await request.Content!.ReadAsStringAsync(ct))!.AsObject();
            s.Calls.Enqueue((path, body));
            if (s.Down) return new HttpResponseMessage(HttpStatusCode.BadGateway);
            object? data = null;
            var status = 0;
            switch (path)
            {
                case "/website/companies/getdetails/":
                    data = new { Company = new { Name = "עסק בדיקה", CompanyType = s.OrganizationType } };
                    break;
                case "/billing/payments/beginredirect/":
                    if (s.RefuseBegin) status = 1;
                    else data = new { RedirectURL = "https://pay.sumit.test/page/" + Guid.NewGuid().ToString("N") };
                    break;
                case "/billing/payments/get/":
                    if (s.Payments.TryGetValue(body["PaymentID"]!.GetValue<long>(), out var p)) data = new { Payment = p };
                    else status = 1;
                    break;
                case "/billing/payments/list/":
                    data = new { Payments = s.Payments.Values.Where(x => (bool)x["ValidPayment"]!).ToList(), HasNextPage = false };
                    break;
                case "/accounting/documents/getdetails/":
                    if (s.DocumentsDown) return new HttpResponseMessage(HttpStatusCode.BadGateway);
                    data = new { DocumentID = body["DocumentID"]!.GetValue<long>(), DocumentNumber = 40000 + body["DocumentID"]!.GetValue<long>(), Document = new { IsDraft = false, Type = s.IssuedDocumentType } };
                    break;
                default:
                    return new HttpResponseMessage(HttpStatusCode.NotFound);
            }
            var json = JsonSerializer.Serialize(new { Status = status, UserErrorMessage = status == 0 ? null : "refused", Data = data });
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        }
    }
}

/// <summary>SUMIT payments: a redirect to the hosted page, and nothing paid unless SUMIT itself confirms it to the server.</summary>
[Collection(DatabaseCollection.Name)]
public class SumitPaymentTests
{
    private const string ApiKey = "FAKE-SUMIT-KEY-never-in-logs-0123456789";
    private const string Begin = "/billing/payments/beginredirect/";
    private const string Get = "/billing/payments/get/";
    private const string List = "/billing/payments/list/";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly HubIntegrationTests.Factory _factory;

    public SumitPaymentTests(HubIntegrationTests.Factory factory) => _factory = factory;

    private sealed record Site(WebApplicationFactory<Program> F, FakeSumit Sumit, CapturedLogs Logs)
    {
        public HttpClient Http { get; } = F.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost") });

        public async Task<T> Db<T>(Func<PortalDbContext, Task<T>> f)
        {
            using var scope = F.Services.CreateScope();
            return await f(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
        }

        public async Task<T> Rec<T>(Func<SumitReconciler, Task<T>> f)
        {
            using var scope = F.Services.CreateScope();
            return await f(scope.ServiceProvider.GetRequiredService<SumitReconciler>());
        }

        public Task<Order> Order(Guid id) => Db(db => db.Orders.AsNoTracking().SingleAsync(o => o.Id == id));
    }

    /// <summary>The site with the SUMIT provider on a fake connection. "Production" means real payments; otherwise test mode.</summary>
    private Site Start(bool production = false, Dictionary<string, string?>? extra = null)
    {
        var sumit = new FakeSumit();
        var logs = new CapturedLogs();
        var f = _factory.WithWebHostBuilder(b =>
        {
            if (production) b.UseEnvironment("Production");
            b.ConfigureAppConfiguration((_, c) =>
            {
                var settings = new Dictionary<string, string?>
                {
                    ["Payments:Provider"] = "sumit",
                    ["SUMIT_API_KEY"] = ApiKey,
                    ["SUMIT_COMPANY_ID"] = "999",
                    ["SUMIT_TEST_MODE"] = production ? "false" : "true",
                    ["SUMIT_DAILY_CHECK_LIMIT"] = "100000",
                    ["PORTALX_SITE_URL"] = "https://portalx.test",
                    ["PAYMENTS_MODE"] = "Test",
                    ["ENABLE_TEST_CHECKOUT"] = "true",
                    ["RateLimits:PaymentCheckPerMinute"] = "100000",
                    ["RateLimits:PaymentIpnPerMinute"] = "100000",
                };
                foreach (var (k, v) in extra ?? []) settings[k] = v;
                c.AddInMemoryCollection(settings);
            });
            b.ConfigureLogging(l => l.AddProvider(logs));
            b.ConfigureTestServices(s => s.AddSingleton<SumitHttp>(sumit));
        });
        return new Site(f, sumit, logs);
    }

    private sealed record Buy(Guid Id, string Key, string CheckoutUrl, decimal Price);

    private static async Task<Buy> BuyAsync(Site s, string productId = ProductId, string? email = null, string? coupon = null)
    {
        await EnsureProductAsync(s.F.Services);
        var res = await s.Http.PostAsJsonAsync("/api/orders", new { productId, email, couponCode = coupon });
        res.EnsureSuccessStatusCode();
        var o = await res.Content.ReadFromJsonAsync<JsonElement>(Json);
        return new Buy(o.GetProperty("orderId").GetGuid(), o.GetProperty("accessKey").GetString()!, o.GetProperty("checkoutUrl").GetString()!, o.GetProperty("price").GetDecimal());
    }

    private static async Task<JsonElement> ViewAsync(Site s, Buy b) =>
        await (await s.Http.SendAsync(WithKey(HttpMethod.Get, $"/api/orders/{b.Id}", b.Key))).Content.ReadFromJsonAsync<JsonElement>(Json);

    private static async Task<JsonElement> ReturnAsync(Site s, Buy b, long? paymentId)
    {
        var req = WithKey(HttpMethod.Post, $"/api/orders/{b.Id}/payment-check", b.Key);
        req.Content = JsonContent.Create(new { paymentId = paymentId?.ToString() });
        var res = await s.Http.SendAsync(req);
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<JsonElement>(Json);
    }

    private static async Task<HttpResponseMessage> IpnAsync(Site s, Buy b, string? session = null, string body = "{}")
    {
        session ??= (await s.Order(b.Id)).ProviderSessionId;
        return await s.Http.PostAsync($"/api/payments/ipn/sumit/{b.Id}/{session}", new StringContent(body, Encoding.UTF8, "application/json"));
    }

    private static Task<HttpResponseMessage> OpenAsync(Site s, Buy b) => s.Http.SendAsync(WithKey(HttpMethod.Post, $"/api/orders/{b.Id}/game", b.Key));

    private static async Task AssertNotOpenableAsync(Site s, Buy b, string status = "pending")
    {
        var view = await ViewAsync(s, b);
        Assert.Equal(status, view.GetProperty("status").GetString());
        Assert.False(view.GetProperty("canOpenGame").GetBoolean());
        Assert.Equal(HttpStatusCode.Conflict, (await OpenAsync(s, b)).StatusCode);
        Assert.False(await s.Db(db => db.Entitlements.AnyAsync(e => e.OrderId == b.Id)));
    }

    // ------------------------------------------------------------------ opening the payment page

    [Fact]
    public async Task The_payment_page_gets_the_server_price_and_no_document_is_ever_created_by_this_site()
    {
        var s = Start();
        await EnsureProductAsync(s.F.Services);
        // a price sent by the browser is ignored
        var res = await s.Http.PostAsJsonAsync("/api/orders", new { productId = ProductId, price = 1, amount = 1, email = "buyer@example.com" });
        res.EnsureSuccessStatusCode();
        var o = await res.Content.ReadFromJsonAsync<JsonElement>(Json);
        var id = o.GetProperty("orderId").GetGuid();
        Assert.StartsWith("https://pay.sumit.test/", o.GetProperty("checkoutUrl").GetString());

        var sent = s.Sumit.Calls.Single(c => c.Path == Begin).Body;
        var order = await s.Order(id);
        Assert.Equal(Price, sent["Items"]![0]!["UnitPrice"]!.GetValue<decimal>());
        Assert.Equal(id.ToString(), sent["ExternalIdentifier"]!.GetValue<string>());
        Assert.Equal(0, sent["MaximumPayments"]!.GetValue<int>());
        Assert.False(sent["DraftDocument"]!.GetValue<bool>());
        Assert.True(sent["VATIncluded"]!.GetValue<bool>());
        Assert.Equal("buyer@example.com", sent["Customer"]!["EmailAddress"]!.GetValue<string>());
        Assert.Equal(999, sent["Credentials"]!["CompanyID"]!.GetValue<long>());
        Assert.Equal($"https://portalx.test/checkout/{id}", sent["RedirectURL"]!.GetValue<string>());
        Assert.Equal($"https://portalx.test/checkout/{id}/cancelled", sent["CancelRedirectURL"]!.GetValue<string>());
        Assert.Equal($"https://portalx.test/api/payments/ipn/sumit/{id}/{order.ProviderSessionId}", sent["IPNURL"]!.GetValue<string>());
        // the buyer's order key never travels to the provider
        Assert.DoesNotContain(o.GetProperty("accessKey").GetString()!, sent.ToJsonString());
        Assert.Equal(OrderStatus.Pending, order.Status);
        Assert.True(order.IsTest);
        Assert.Equal(0, s.Sumit.ReadCalls);
        Assert.DoesNotContain(s.Sumit.Calls, c => c.Path.Contains("documents/create"));
    }

    [Fact]
    public async Task A_refused_payment_page_fails_the_order_and_returns_the_coupon()
    {
        var s = Start();
        var coupon = await CouponAsync(s, 10);
        s.Sumit.RefuseBegin = true;
        await EnsureProductAsync(s.F.Services);
        var res = await s.Http.PostAsJsonAsync("/api/orders", new { productId = ProductId, couponCode = coupon });
        Assert.Equal((HttpStatusCode)502, res.StatusCode);
        Assert.Equal("payment-start-failed", (await res.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("code").GetString());
        var order = await s.Db(db => db.Orders.AsNoTracking().OrderByDescending(o => o.CreatedAt).FirstAsync(o => o.CouponCode == coupon));
        Assert.Equal(OrderStatus.Failed, order.Status);
        Assert.Equal(RedemptionStatus.Released, await s.Db(db => db.CouponRedemptions.Where(r => r.OrderId == order.Id).Select(r => r.Status).SingleAsync()));

        s.Sumit.RefuseBegin = false;
        s.Sumit.Down = true;
        Assert.Equal((HttpStatusCode)502, (await s.Http.PostAsJsonAsync("/api/orders", new { productId = ProductId })).StatusCode);
    }

    // ------------------------------------------------------------------ success

    [Fact]
    public async Task A_confirmed_return_opens_exactly_one_game_and_records_the_document()
    {
        var s = Start();
        var b = await BuyAsync(s, email: "buyer@example.com");
        await AssertNotOpenableAsync(s, b);

        var payment = s.Sumit.Pay(b.Id, b.Price);
        var view = await ReturnAsync(s, b, payment);
        Assert.Equal("paid", view.GetProperty("status").GetString());
        Assert.True(view.GetProperty("canOpenGame").GetBoolean());

        var order = await s.Order(b.Id);
        Assert.Equal(payment.ToString(), order.ProviderTransactionId);
        Assert.NotNull(order.PaymentVerifiedAt);
        Assert.Equal(900, order.ProviderCustomerId);
        Assert.Equal(s.Sumit.Payments[payment]["DocumentID"], order.ProviderDocumentId);
        Assert.Equal(40000 + order.ProviderDocumentId, order.ProviderDocumentNumber);
        Assert.Null(order.ProviderIssue);
        Assert.Equal("return", await s.Db(db => db.PaymentEvents.Where(e => e.ProviderEventId == $"pay:{payment}").Select(e => e.Source).SingleAsync()));

        var first = await (await OpenAsync(s, b)).Content.ReadFromJsonAsync<JsonElement>(Json);
        var second = await (await OpenAsync(s, b)).Content.ReadFromJsonAsync<JsonElement>(Json);
        Assert.Equal(first.GetProperty("code").GetString(), second.GetProperty("code").GetString());
        Assert.Equal(1, await s.Db(db => db.Entitlements.CountAsync(e => e.OrderId == b.Id)));
        Assert.DoesNotContain(s.Sumit.Calls, c => c.Path.Contains("documents/create"));
        // a confirmed order asks nothing more
        var calls = s.Sumit.ReadCalls;
        await ReturnAsync(s, b, payment);
        await ReturnAsync(s, b, null);
        Assert.Equal(calls, s.Sumit.ReadCalls);
    }

    [Fact]
    public async Task An_ipn_finds_the_payment_through_sumit_itself()
    {
        var s = Start();
        var b = await BuyAsync(s);
        var payment = s.Sumit.Pay(b.Id, b.Price);
        Assert.Equal(HttpStatusCode.OK, (await IpnAsync(s, b)).StatusCode);
        Assert.Equal("paid", (await ViewAsync(s, b)).GetProperty("status").GetString());
        Assert.Equal(1, s.Sumit.Count(List));
        Assert.Equal(1, s.Sumit.Count(Get));
        Assert.Equal(payment.ToString(), (await s.Order(b.Id)).ProviderTransactionId);
    }

    [Fact]
    public async Task A_payment_without_a_document_is_paid_and_flagged_and_no_document_is_created()
    {
        var s = Start();
        var b = await BuyAsync(s);
        await ReturnAsync(s, b, s.Sumit.Pay(b.Id, b.Price, withDocument: false));
        var order = await s.Order(b.Id);
        Assert.Equal(OrderStatus.Paid, order.Status);
        Assert.Equal("document-missing", order.ProviderIssue);
        Assert.DoesNotContain(s.Sumit.Calls, c => c.Path.Contains("documents/"));
    }

    // ------------------------------------------------------------------ nothing opens a game without a confirmed payment

    [Fact]
    public async Task An_ipn_alone_proves_nothing()
    {
        var s = Start();
        var b = await BuyAsync(s);
        // a forged message that claims everything: SUMIT knows no such payment
        const string forged = """{"ValidPayment":true,"Status":"000","PaymentID":999999,"Amount":50,"ExternalIdentifier":"x"}""";
        Assert.Equal(HttpStatusCode.OK, (await IpnAsync(s, b, body: forged)).StatusCode);
        await AssertNotOpenableAsync(s, b);
        Assert.Equal(0, s.Sumit.Count(Get));
        // the wrong session never reaches SUMIT at all
        var calls = s.Sumit.ReadCalls;
        Assert.Equal(HttpStatusCode.NotFound, (await IpnAsync(s, b, session: "sm_wrong", body: forged)).StatusCode);
        Assert.Equal(calls, s.Sumit.ReadCalls);
        // the generic notification route refuses this provider outright
        var hook = await s.Http.PostAsync("/api/payments/webhook/sumit", new StringContent(forged, Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Unauthorized, hook.StatusCode);
        await AssertNotOpenableAsync(s, b);
    }

    [Fact]
    public async Task A_return_address_alone_proves_nothing()
    {
        var s = Start();
        var b = await BuyAsync(s);
        await ReturnAsync(s, b, 123456);
        await AssertNotOpenableAsync(s, b);

        // somebody else's real payment
        var other = await BuyAsync(s);
        await ReturnAsync(s, b, s.Sumit.Pay(other.Id, other.Price));
        await AssertNotOpenableAsync(s, b);
        await AssertNotOpenableAsync(s, other);

        // without the order key nothing happens at all
        var calls = s.Sumit.ReadCalls;
        var noKey = WithKey(HttpMethod.Post, $"/api/orders/{b.Id}/payment-check", "wrong-key");
        noKey.Content = JsonContent.Create(new { paymentId = "1" });
        Assert.Equal(HttpStatusCode.NotFound, (await s.Http.SendAsync(noKey)).StatusCode);
        Assert.Equal(calls, s.Sumit.ReadCalls);
    }

    [Theory]
    [InlineData("invalid")]
    [InlineData("low-amount")]
    [InlineData("high-amount")]
    [InlineData("usd")]
    [InlineData("unknown-currency")]
    public async Task A_payment_that_does_not_match_the_order_changes_nothing(string kind)
    {
        var s = Start();
        var b = await BuyAsync(s);
        var payment = kind switch
        {
            "invalid" => s.Sumit.Pay(b.Id, b.Price, valid: false),
            "low-amount" => s.Sumit.Pay(b.Id, b.Price - 1),
            "high-amount" => s.Sumit.Pay(b.Id, b.Price + 1),
            "usd" => s.Sumit.Pay(b.Id, b.Price, currency: 1),
            _ => s.Sumit.Pay(b.Id, b.Price, currency: "Something"),
        };
        await ReturnAsync(s, b, payment);
        await AssertNotOpenableAsync(s, b);
    }

    [Fact]
    public async Task Sumit_being_unavailable_leaves_the_order_unpaid_until_it_answers()
    {
        var s = Start();
        var b = await BuyAsync(s);
        var payment = s.Sumit.Pay(b.Id, b.Price);
        s.Sumit.Down = true;
        await ReturnAsync(s, b, payment);
        Assert.Equal(HttpStatusCode.OK, (await IpnAsync(s, b)).StatusCode);
        await AssertNotOpenableAsync(s, b);

        s.Sumit.Down = false;
        Assert.Equal("paid", (await ReturnAsync(s, b, payment)).GetProperty("status").GetString());
    }

    // ------------------------------------------------------------------ cancel, return without paying

    [Fact]
    public async Task Cancel_closes_the_order_only_after_sumit_shows_no_payment_and_returns_the_coupon()
    {
        var s = Start();
        var coupon = await CouponAsync(s, 10);
        var b = await BuyAsync(s, coupon: coupon);
        var res = await s.Http.SendAsync(WithKey(HttpMethod.Post, $"/api/orders/{b.Id}/payment-cancelled", b.Key));
        Assert.Equal("cancelled", (await res.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("status").GetString());
        await AssertNotOpenableAsync(s, b, "cancelled");
        Assert.Equal(RedemptionStatus.Released, await s.Db(db => db.CouponRedemptions.Where(r => r.OrderId == b.Id).Select(r => r.Status).SingleAsync()));

        // a payment that arrives after all still counts, and the coupon use comes back with it
        var late = s.Sumit.Pay(b.Id, b.Price);
        Assert.Equal("paid", (await ReturnAsync(s, b, late)).GetProperty("status").GetString());
        Assert.Equal(RedemptionStatus.Redeemed, await s.Db(db => db.CouponRedemptions.Where(r => r.OrderId == b.Id).Select(r => r.Status).SingleAsync()));
    }

    [Fact]
    public async Task Cancel_with_a_payment_on_record_is_a_paid_order_and_failure_of_the_check_changes_nothing()
    {
        var s = Start();
        var paid = await BuyAsync(s);
        s.Sumit.Pay(paid.Id, paid.Price);
        await s.Http.SendAsync(WithKey(HttpMethod.Post, $"/api/orders/{paid.Id}/payment-cancelled", paid.Key));
        Assert.Equal("paid", (await ViewAsync(s, paid)).GetProperty("status").GetString());

        var b = await BuyAsync(s);
        s.Sumit.Down = true;
        await s.Http.SendAsync(WithKey(HttpMethod.Post, $"/api/orders/{b.Id}/payment-cancelled", b.Key));
        Assert.Equal("pending", (await ViewAsync(s, b)).GetProperty("status").GetString());
    }

    [Fact]
    public async Task Returning_without_paying_keeps_the_order_waiting_and_the_game_closed()
    {
        var s = Start();
        var b = await BuyAsync(s);
        Assert.Equal("pending", (await ReturnAsync(s, b, null)).GetProperty("status").GetString());
        await AssertNotOpenableAsync(s, b);
    }

    // ------------------------------------------------------------------ duplicates, races, crashes

    [Fact]
    public async Task Duplicate_ipns_change_nothing_and_cost_no_extra_calls()
    {
        var s = Start();
        var b = await BuyAsync(s);
        var payment = s.Sumit.Pay(b.Id, b.Price);
        for (var i = 0; i < 5; i++) Assert.Equal(HttpStatusCode.OK, (await IpnAsync(s, b)).StatusCode);
        Assert.Equal(1, s.Sumit.Count(List));
        Assert.Equal(1, s.Sumit.Count(Get));

        // the same notification much later, past the spacing: asks once, applies nothing new
        await s.Db(db => db.Orders.Where(o => o.Id == b.Id).ExecuteUpdateAsync(x => x.SetProperty(o => o.LastReconciledAt, (DateTime?)null)));
        Assert.Equal(HttpStatusCode.OK, (await IpnAsync(s, b)).StatusCode);
        Assert.Equal(1, s.Sumit.Count(Get));
        Assert.Equal(1, await s.Db(db => db.PaymentEvents.CountAsync(e => e.ProviderEventId == $"pay:{payment}")));
        Assert.Equal(1, await s.Db(db => db.Entitlements.CountAsync(e => e.OrderId == b.Id)));
    }

    [Fact]
    public async Task An_ipn_and_returns_at_the_same_moment_make_one_paid_order()
    {
        var s = Start();
        var b = await BuyAsync(s);
        var payment = s.Sumit.Pay(b.Id, b.Price);
        var work = new List<Task>();
        for (var i = 0; i < 6; i++)
        {
            work.Add(IpnAsync(s, b));
            work.Add(ReturnAsync(s, b, payment));
        }
        await Task.WhenAll(work);

        var order = await s.Order(b.Id);
        Assert.Equal(OrderStatus.Paid, order.Status);
        Assert.Null(order.ProviderIssue);
        Assert.Equal(1, await s.Db(db => db.Entitlements.CountAsync(e => e.OrderId == b.Id)));
        Assert.Equal(1, await s.Db(db => db.PaymentEvents.CountAsync(e => e.OrderId == b.Id && e.ProviderEventId == $"pay:{payment}")));
        Assert.Equal("applied:paid", await s.Db(db => db.PaymentEvents.Where(e => e.ProviderEventId == $"pay:{payment}").Select(e => e.Result).SingleAsync()));
    }

    [Fact]
    public async Task Opening_the_game_many_times_at_once_makes_one_game()
    {
        var s = Start();
        var b = await BuyAsync(s);
        await ReturnAsync(s, b, s.Sumit.Pay(b.Id, b.Price));
        await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => OpenAsync(s, b)));
        var ent = await s.Db(db => db.Entitlements.AsNoTracking().SingleAsync(e => e.OrderId == b.Id));
        Assert.Equal(1, ent.SessionsUsed);
        Assert.Equal(1, await s.Db(db => db.Rooms.CountAsync(r => r.EntitlementId == ent.Id)));
    }

    [Fact]
    public async Task A_crash_in_the_middle_never_opens_a_game_and_never_blocks_the_payment()
    {
        var s = Start();
        var b = await BuyAsync(s);
        var payment = s.Sumit.Pay(b.Id, b.Price);
        // what a crash leaves behind: the event was saved, the order was not changed
        await s.Db(async db =>
        {
            db.PaymentEvents.Add(new PaymentEvent
            {
                Provider = "sumit", ProviderEventId = $"pay:{payment}", OrderId = b.Id, Type = "succeeded", Amount = b.Price, Currency = "ILS",
                ProviderTransactionId = payment.ToString(), IsTest = true, Result = "received", ReceivedAt = DateTime.UtcNow,
            });
            return await db.SaveChangesAsync();
        });
        await AssertNotOpenableAsync(s, b);

        Assert.Equal("paid", (await ReturnAsync(s, b, payment)).GetProperty("status").GetString());
        Assert.Equal("applied:paid", await s.Db(db => db.PaymentEvents.Where(e => e.ProviderEventId == $"pay:{payment}").Select(e => e.Result).SingleAsync()));
        Assert.Equal(1, await s.Db(db => db.Entitlements.CountAsync(e => e.OrderId == b.Id)));
    }

    [Fact]
    public async Task Paying_twice_for_one_order_gives_one_game_and_tells_the_admin()
    {
        var s = Start();
        var b = await BuyAsync(s);
        await ReturnAsync(s, b, s.Sumit.Pay(b.Id, b.Price));
        var second = s.Sumit.Pay(b.Id, b.Price);
        await ReturnAsync(s, b, second);
        var order = await s.Order(b.Id);
        Assert.Equal($"second-payment:{second}", order.ProviderIssue);
        Assert.Equal(OrderStatus.Paid, order.Status);
        Assert.Equal(1, await s.Db(db => db.Entitlements.CountAsync(e => e.OrderId == b.Id)));
    }

    [Fact]
    public async Task One_payment_can_never_pay_for_two_orders()
    {
        var s = Start();
        var b = await BuyAsync(s);
        var payment = s.Sumit.Pay(b.Id, b.Price);
        await ReturnAsync(s, b, payment);
        var other = await BuyAsync(s);
        await ReturnAsync(s, other, payment);
        await AssertNotOpenableAsync(s, other);
        // the database itself refuses it too
        await Assert.ThrowsAsync<DbUpdateException>(() => s.Db(async db =>
        {
            var o = await db.Orders.SingleAsync(x => x.Id == other.Id);
            o.ProviderTransactionId = payment.ToString();
            return await db.SaveChangesAsync();
        }));
    }

    [Fact]
    public async Task Two_purchases_at_the_same_moment_stay_apart()
    {
        var s = Start();
        var buys = await Task.WhenAll(BuyAsync(s, email: "a@example.com"), BuyAsync(s, email: "b@example.com"));
        Assert.NotEqual(buys[0].Id, buys[1].Id);
        var firstPayment = s.Sumit.Pay(buys[0].Id, buys[0].Price);
        await ReturnAsync(s, buys[0], firstPayment);
        Assert.Equal("paid", (await ViewAsync(s, buys[0])).GetProperty("status").GetString());
        await AssertNotOpenableAsync(s, buys[1]);

        await ReturnAsync(s, buys[1], s.Sumit.Pay(buys[1].Id, buys[1].Price));
        var codes = new List<string>();
        foreach (var b in buys) codes.Add((await (await OpenAsync(s, b)).Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("code").GetString()!);
        Assert.NotEqual(codes[0], codes[1]);
    }

    // ------------------------------------------------------------------ every game

    [Fact]
    public async Task Every_game_in_the_catalog_is_bought_the_same_way()
    {
        var s = Start();
        var scenarios = s.F.Services.GetRequiredService<ScenarioCatalog>().All.Select(x => x.Id).ToList();
        Assert.NotEmpty(scenarios);
        var ids = scenarios.Select(x => "sumit-test-" + x).ToList();
        await s.Db(async db =>
        {
            await db.Products.Where(p => ids.Contains(p.Id)).ExecuteUpdateAsync(x => x.SetProperty(p => p.Status, ProductStatus.Published));
            foreach (var scenario in scenarios)
                if (!await db.Products.AnyAsync(p => p.Id == "sumit-test-" + scenario))
                    db.Products.Add(new Product
                    {
                        Id = "sumit-test-" + scenario, Name = "בדיקה " + scenario, PriceIls = 77, Status = ProductStatus.Published, ScenarioId = scenario,
                        MinPlayers = 1, MaxPlayers = 4, SortOrder = 99, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
                    });
            return await db.SaveChangesAsync();
        });
        try
        {
            foreach (var id in ids)
            {
                var b = await BuyAsync(s, productId: id);
                Assert.Equal(77m, b.Price);
                await AssertNotOpenableAsync(s, b);
                await ReturnAsync(s, b, s.Sumit.Pay(b.Id, b.Price));
                var opened = await OpenAsync(s, b);
                Assert.Equal(HttpStatusCode.OK, opened.StatusCode);
            }
        }
        finally
        {
            // the catalog tests see only what they expect; the orders stay as history
            await s.Db(db => db.Products.Where(p => ids.Contains(p.Id)).ExecuteUpdateAsync(x => x.SetProperty(p => p.Status, ProductStatus.Draft)));
        }
    }

    // ------------------------------------------------------------------ the periodic check and its cost

    [Fact]
    public void An_order_is_due_only_at_its_few_checkpoints()
    {
        var created = new DateTime(2026, 11, 1, 12, 0, 0, DateTimeKind.Utc);
        var o = new Order { CreatedAt = created, CheckoutExpiresAt = created.AddHours(1) };
        Assert.False(SumitReconciler.IsDue(o, created.AddMinutes(9)));
        Assert.True(SumitReconciler.IsDue(o, created.AddMinutes(10)));
        o.LastReconciledAt = created.AddMinutes(10);
        Assert.False(SumitReconciler.IsDue(o, created.AddMinutes(29)));
        Assert.True(SumitReconciler.IsDue(o, created.AddMinutes(30)));
        o.LastReconciledAt = created.AddMinutes(30);
        Assert.False(SumitReconciler.IsDue(o, created.AddMinutes(64)));
        Assert.True(SumitReconciler.IsDue(o, created.AddMinutes(65)));
        // a server that slept through the first checkpoints looks once
        o.LastReconciledAt = null;
        Assert.True(SumitReconciler.IsDue(o, created.AddMinutes(70)));
        o.LastReconciledAt = created.AddMinutes(70);
        Assert.False(SumitReconciler.IsDue(o, created.AddMinutes(100)));
        Assert.True(SumitReconciler.IsDue(o, created.AddMinutes(131)));
    }

    /// <summary>Sweeps the moment each checkpoint of this order comes, and also in between.</summary>
    private static async Task SweepThroughAsync(Site s, DateTime created)
    {
        foreach (var minutes in new[] { 1, 5, 9, 10, 15, 25, 30, 45, 60, 64, 65, 70 })
            await s.Rec(r => r.SweepAsync(created.AddMinutes(minutes)));
    }

    private static async Task<DateTime> OnlyThisOpenAsync(Site s, Buy b)
    {
        // other tests may have left open orders in this database: close them so that the count below is about this order
        await s.Db(db => db.Orders.Where(o => o.Provider == "sumit" && o.Status == OrderStatus.Pending && o.Id != b.Id)
            .ExecuteUpdateAsync(x => x.SetProperty(o => o.Status, OrderStatus.Cancelled)));
        return (await s.Order(b.Id)).CreatedAt;
    }

    [Fact]
    public async Task No_open_orders_means_no_calls_at_all()
    {
        var s = Start();
        await s.Db(db => db.Orders.Where(o => o.Provider == "sumit" && o.Status == OrderStatus.Pending)
            .ExecuteUpdateAsync(x => x.SetProperty(o => o.Status, OrderStatus.Cancelled)));
        for (var i = 0; i < 20; i++) Assert.Equal(0, await s.Rec(r => r.SweepAsync(DateTime.UtcNow.AddMinutes(i * 5))));
        Assert.Empty(s.Sumit.Calls);
    }

    [Fact]
    public async Task An_abandoned_order_costs_three_checks_and_then_closes_for_good()
    {
        var s = Start();
        var coupon = await CouponAsync(s, 10);
        var b = await BuyAsync(s, coupon: coupon);
        var created = await OnlyThisOpenAsync(s, b);
        await SweepThroughAsync(s, created);
        Assert.Equal(3, s.Sumit.Count(List));
        Assert.Equal(0, s.Sumit.Count(Get));
        var order = await s.Order(b.Id);
        Assert.Equal(OrderStatus.Cancelled, order.Status);
        Assert.Equal(RedemptionStatus.Released, await s.Db(db => db.CouponRedemptions.Where(r => r.OrderId == b.Id).Select(r => r.Status).SingleAsync()));
        // nothing more is ever asked about it
        await s.Rec(r => r.SweepAsync(created.AddDays(2)));
        Assert.Equal(3, s.Sumit.Count(List));
        await AssertNotOpenableAsync(s, b, "cancelled");

        // and if the buyer did pay in the end, the notification still counts
        s.Sumit.Pay(b.Id, b.Price);
        await s.Db(db => db.Orders.Where(o => o.Id == b.Id).ExecuteUpdateAsync(x => x.SetProperty(o => o.LastReconciledAt, (DateTime?)null)));
        await IpnAsync(s, b);
        Assert.Equal("paid", (await ViewAsync(s, b)).GetProperty("status").GetString());
    }

    [Fact]
    public async Task The_periodic_check_finds_a_payment_whose_notification_never_came()
    {
        var s = Start();
        var b = await BuyAsync(s);
        var created = await OnlyThisOpenAsync(s, b);
        var payment = s.Sumit.Pay(b.Id, b.Price);
        await s.Rec(r => r.SweepAsync(created.AddMinutes(10)));
        Assert.Equal(1, s.Sumit.Count(List));
        Assert.Equal(1, s.Sumit.Count(Get));
        var order = await s.Order(b.Id);
        Assert.Equal(OrderStatus.Paid, order.Status);
        Assert.Equal(payment.ToString(), order.ProviderTransactionId);
        Assert.Equal("sweep", await s.Db(db => db.PaymentEvents.Where(e => e.ProviderEventId == $"pay:{payment}").Select(e => e.Source).SingleAsync()));
    }

    [Fact]
    public async Task Many_due_orders_share_one_list_call_and_a_failed_list_closes_nothing()
    {
        var s = Start();
        var a = await BuyAsync(s);
        var c = await BuyAsync(s);
        var created = await OnlyThisOpenAsync(s, a);
        await s.Db(db => db.Orders.Where(o => o.Id == c.Id).ExecuteUpdateAsync(x => x.SetProperty(o => o.Status, OrderStatus.Pending)));
        var late = created.AddHours(3);
        s.Sumit.Down = true;
        await s.Rec(r => r.SweepAsync(late));
        Assert.Equal(1, s.Sumit.Count(List));
        Assert.Equal(OrderStatus.Pending, (await s.Order(a.Id)).Status);
        Assert.Equal(OrderStatus.Pending, (await s.Order(c.Id)).Status);

        s.Sumit.Down = false;
        await s.Rec(r => r.SweepAsync(late.AddMinutes(5)));
        Assert.Equal(2, s.Sumit.Count(List));
        Assert.Equal(OrderStatus.Cancelled, (await s.Order(a.Id)).Status);
        Assert.Equal(OrderStatus.Cancelled, (await s.Order(c.Id)).Status);
    }

    [Fact]
    public async Task The_daily_limit_stops_the_calls_and_never_marks_anything_paid()
    {
        var s = Start(extra: new() { ["SUMIT_DAILY_CHECK_LIMIT"] = "1" });
        var b = await BuyAsync(s);
        var payment = s.Sumit.Pay(b.Id, b.Price);
        await ReturnAsync(s, b, null); // spends the one call on the list
        Assert.Equal(1, s.Sumit.ReadCalls);
        await AssertNotOpenableAsync(s, b);
        await ReturnAsync(s, b, payment);
        await IpnAsync(s, b);
        await s.Rec(r => r.SweepAsync(DateTime.UtcNow.AddHours(3)));
        Assert.Equal(1, s.Sumit.ReadCalls);
        await AssertNotOpenableAsync(s, b);
    }

    [Fact]
    public async Task Page_loads_and_repeated_questions_are_spaced_per_order()
    {
        var s = Start();
        var b = await BuyAsync(s);
        for (var i = 0; i < 10; i++) await ReturnAsync(s, b, null);
        Assert.Equal(1, s.Sumit.Count(List));
    }

    // ------------------------------------------------------------------ refund: the history stays

    private static async Task<HttpClient> AdminAsync(Site s)
    {
        var http = s.F.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false, BaseAddress = new Uri("https://localhost") });
        (await http.PostAsJsonAsync("/api/admin/login", new { username = AdminTests.Username, password = AdminTests.Password })).EnsureSuccessStatusCode();
        http.DefaultRequestHeaders.Add(AdminAuth.CsrfHeader, "1");
        return http;
    }

    [Fact]
    public async Task A_refund_closes_the_game_and_keeps_the_order_the_game_and_the_events()
    {
        var s = Start();
        var coupon = await CouponAsync(s, 10);
        var b = await BuyAsync(s, coupon: coupon);
        var payment = s.Sumit.Pay(b.Id, b.Price);
        await ReturnAsync(s, b, payment);
        var code = (await (await OpenAsync(s, b)).Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("code").GetString()!;

        Assert.Equal(HttpStatusCode.Unauthorized, (await s.Http.PostAsync($"/api/admin/orders/{b.Id}/mark-refunded", null)).StatusCode);
        var admin = await AdminAsync(s);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"/api/admin/orders/{b.Id}/mark-refunded", null)).StatusCode);

        var order = await s.Order(b.Id);
        Assert.Equal(OrderStatus.Refunded, order.Status);
        Assert.Equal(b.Price, order.RefundedAmount);
        Assert.Equal(payment.ToString(), order.ProviderTransactionId);
        Assert.NotNull(order.PaidAt);
        var ent = await s.Db(db => db.Entitlements.AsNoTracking().SingleAsync(e => e.OrderId == b.Id));
        Assert.True(ent.Revoked);
        Assert.Equal(code, await s.Db(db => db.Rooms.Where(r => r.EntitlementId == ent.Id).Select(r => r.Code).SingleAsync()));
        Assert.Equal(2, await s.Db(db => db.PaymentEvents.CountAsync(e => e.OrderId == b.Id)));
        Assert.Equal(RedemptionStatus.Refunded, await s.Db(db => db.CouponRedemptions.Where(r => r.OrderId == b.Id).Select(r => r.Status).SingleAsync()));
        Assert.Equal(HttpStatusCode.Conflict, (await OpenAsync(s, b)).StatusCode);

        // the same payment arriving again never reopens it, and the order stays in the admin's list
        await s.Db(db => db.Orders.Where(o => o.Id == b.Id).ExecuteUpdateAsync(x => x.SetProperty(o => o.LastReconciledAt, (DateTime?)null)));
        await IpnAsync(s, b);
        await ReturnAsync(s, b, payment);
        Assert.Equal(OrderStatus.Refunded, (await s.Order(b.Id)).Status);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync($"/api/admin/orders/{b.Id}/mark-refunded", null)).StatusCode);
        var rows = await (await admin.GetAsync("/api/admin/orders?includeTest=true")).Content.ReadFromJsonAsync<JsonElement>(Json);
        Assert.Contains(rows.EnumerateArray(), r => r.GetProperty("id").GetGuid() == b.Id && r.GetProperty("status").GetString() == "refunded");
    }

    [Fact]
    public async Task The_admin_check_finds_a_payment_and_reports_the_document_in_the_list()
    {
        var s = Start();
        var b = await BuyAsync(s);
        var admin = await AdminAsync(s);
        Assert.Equal("none", (await (await admin.PostAsync($"/api/admin/orders/{b.Id}/check-payment", null)).Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("result").GetString());
        s.Sumit.Pay(b.Id, b.Price);
        Assert.Equal("applied:paid", (await (await admin.PostAsync($"/api/admin/orders/{b.Id}/check-payment", null)).Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("result").GetString());
        var rows = await (await admin.GetAsync("/api/admin/orders?includeTest=true")).Content.ReadFromJsonAsync<JsonElement>(Json);
        var row = rows.EnumerateArray().Single(r => r.GetProperty("id").GetGuid() == b.Id);
        Assert.True(row.GetProperty("documentNumber").GetInt64() > 40000);
    }

    // ------------------------------------------------------------------ prices, coupons, the draw

    private static async Task<string> CouponAsync(Site s, decimal value)
    {
        await EnsureProductAsync(s.F.Services);
        var code = "SUMIT" + Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
        await s.Db(async db =>
        {
            var c = new Coupon { Id = Guid.NewGuid(), Code = code, Name = "בדיקה", Kind = CouponKind.Fixed, Value = value, Active = true, CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow };
            c.Products.Add(new CouponProduct { CouponId = c.Id, ProductId = ProductId });
            db.Coupons.Add(c);
            return await db.SaveChangesAsync();
        });
        return code;
    }

    [Fact]
    public async Task A_coupon_price_is_what_is_charged_and_the_full_price_does_not_match_it()
    {
        var s = Start();
        var coupon = await CouponAsync(s, 10);
        var b = await BuyAsync(s, coupon: coupon);
        Assert.Equal(Price - 10, b.Price);
        Assert.Equal(Price - 10, s.Sumit.Calls.Single(c => c.Path == Begin).Body["Items"]![0]!["UnitPrice"]!.GetValue<decimal>());

        await ReturnAsync(s, b, s.Sumit.Pay(b.Id, Price));
        await AssertNotOpenableAsync(s, b);
        await ReturnAsync(s, b, s.Sumit.Pay(b.Id, b.Price));
        Assert.Equal(OrderStatus.Paid, (await s.Order(b.Id)).Status);
        Assert.Equal(RedemptionStatus.Redeemed, await s.Db(db => db.CouponRedemptions.Where(r => r.OrderId == b.Id).Select(r => r.Status).SingleAsync()));
    }

    [Fact]
    public async Task Real_payments_count_for_the_draw_until_refunded_and_open_games_in_production()
    {
        var s = Start(production: true);
        var provider = s.F.Services.GetRequiredService<PaymentGateway>().Provider!;
        Assert.False(provider.IsTest);
        var b = await BuyAsync(s, email: "buyer@example.com");
        Assert.False((await s.Order(b.Id)).IsTest);
        await ReturnAsync(s, b, s.Sumit.Pay(b.Id, b.Price));
        Assert.Equal(HttpStatusCode.OK, (await OpenAsync(s, b)).StatusCode);

        var paid = await s.Order(b.Id);
        paid.ReferralLinkId = Guid.NewGuid();
        Assert.Single(CampaignContent.Tickets([paid]));

        var admin = await AdminAsync(s);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"/api/admin/orders/{b.Id}/mark-refunded", null)).StatusCode);
        var refunded = await s.Order(b.Id);
        refunded.ReferralLinkId = paid.ReferralLinkId;
        Assert.Empty(CampaignContent.Tickets([refunded]));
    }

    [Fact]
    public async Task Test_payments_never_count_for_the_draw()
    {
        var s = Start();
        var b = await BuyAsync(s, email: "buyer@example.com");
        await ReturnAsync(s, b, s.Sumit.Pay(b.Id, b.Price));
        var order = await s.Order(b.Id);
        order.ReferralLinkId = Guid.NewGuid();
        Assert.True(order.IsTest);
        Assert.Empty(CampaignContent.Tickets([order]));
    }

    // ------------------------------------------------------------------ the real connection check and the trial purchase

    [Fact]
    public async Task The_connection_check_only_reads_and_works_while_the_provider_is_off()
    {
        var s = Start(production: true, extra: new() { ["Payments:Provider"] = "none", ["PAYMENTS_MODE"] = null, ["ENABLE_TEST_CHECKOUT"] = null });
        Assert.False(s.F.Services.GetRequiredService<PaymentGateway>().Available);
        var admin = await AdminAsync(s);
        Assert.Equal(HttpStatusCode.Unauthorized, (await s.Http.PostAsync("/api/admin/sumit/check", null)).StatusCode);
        var res = await admin.PostAsync("/api/admin/sumit/check", null);
        var text = await res.Content.ReadAsStringAsync();
        var r = JsonDocument.Parse(text).RootElement;
        Assert.True(r.GetProperty("configured").GetBoolean());
        Assert.True(r.GetProperty("connected").GetBoolean());
        Assert.True(r.GetProperty("billing").GetBoolean());
        Assert.False(r.GetProperty("providerActive").GetBoolean());
        Assert.Equal("עסק בדיקה", r.GetProperty("organization").GetString());
        Assert.DoesNotContain(ApiKey, text);
        Assert.All(s.Sumit.Calls, c => Assert.True(c.Path is "/website/companies/getdetails/" or List, c.Path));

        s.Sumit.Down = true;
        var down = await (await admin.PostAsync("/api/admin/sumit/check", null)).Content.ReadFromJsonAsync<JsonElement>(Json);
        Assert.False(down.GetProperty("connected").GetBoolean());
    }

    [Fact]
    public async Task Keys_on_the_server_change_nothing_until_the_provider_is_turned_on()
    {
        var s = Start(production: true, extra: new() { ["Payments:Provider"] = "none" });
        await EnsureProductAsync(s.F.Services);
        Assert.False(s.F.Services.GetRequiredService<PaymentGateway>().Available);
        Assert.Equal((HttpStatusCode)503, (await s.Http.PostAsJsonAsync("/api/orders", new { productId = ProductId })).StatusCode);
        var admin = await AdminAsync(s);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync($"/api/admin/products/{ProductId}/trial-order", null)).StatusCode);
        Assert.Empty(s.Sumit.Calls);
    }

    [Fact]
    public async Task A_trial_purchase_passes_a_paused_sale_for_the_admin_alone_and_changes_nothing_else()
    {
        var s = Start(production: true);
        await EnsureProductAsync(s.F.Services);
        await s.Db(db => db.AdminAuditLog.Where(a => a.Action == AdminService.TrialOrderAction).ExecuteDeleteAsync());
        await s.Db(db => db.Products.Where(p => p.Id == ProductId).ExecuteUpdateAsync(x => x.SetProperty(p => p.SalePaused, true)));
        try
        {
            // the public still cannot buy, and the provider being on does not make the game purchasable
            Assert.Equal(HttpStatusCode.Conflict, (await s.Http.PostAsJsonAsync("/api/orders", new { productId = ProductId })).StatusCode);
            var product = await (await s.Http.GetAsync($"/api/products/{ProductId}")).Content.ReadFromJsonAsync<JsonElement>(Json);
            Assert.False(product.GetProperty("purchasable").GetBoolean());
            Assert.Equal(HttpStatusCode.Unauthorized, (await s.Http.PostAsync($"/api/admin/products/{ProductId}/trial-order", null)).StatusCode);
            Assert.Empty(s.Sumit.Calls);

            var admin = await AdminAsync(s);
            var res = await admin.PostAsync($"/api/admin/products/{ProductId}/trial-order", null);
            res.EnsureSuccessStatusCode();
            var o = await res.Content.ReadFromJsonAsync<JsonElement>(Json);
            Assert.Equal(Price, o.GetProperty("price").GetDecimal());
            var b = new Buy(o.GetProperty("orderId").GetGuid(), o.GetProperty("accessKey").GetString()!, o.GetProperty("checkoutUrl").GetString()!, Price);
            Assert.StartsWith("https://pay.sumit.test/", b.CheckoutUrl);

            // no second one while the link may still be open, and the sale is still paused
            Assert.Equal(HttpStatusCode.Conflict, (await admin.PostAsync($"/api/admin/products/{ProductId}/trial-order", null)).StatusCode);
            Assert.True(await s.Db(db => db.Products.Where(p => p.Id == ProductId).Select(p => p.SalePaused).SingleAsync()));

            // nothing opens before payment; after a confirmed payment it does; the draw is untouched
            await AssertNotOpenableAsync(s, b);
            await ReturnAsync(s, b, s.Sumit.Pay(b.Id, b.Price));
            Assert.Equal(HttpStatusCode.OK, (await OpenAsync(s, b)).StatusCode);
            var order = await s.Order(b.Id);
            Assert.False(order.IsTest);
            Assert.Null(order.ReferralLinkId);
        }
        finally
        {
            await s.Db(db => db.Products.Where(p => p.Id == ProductId).ExecuteUpdateAsync(x => x.SetProperty(p => p.SalePaused, false)));
        }
    }

    // ------------------------------------------------------------------ exempt dealer: a receipt, once, at the site's price

    [Fact]
    public async Task An_exempt_dealer_asks_for_a_receipt_at_the_final_price()
    {
        var s = Start();
        var b = await BuyAsync(s);
        var sent = s.Sumit.Calls.Single(c => c.Path == Begin).Body;
        Assert.Equal(2, sent["DocumentType"]!.GetValue<int>());
        Assert.True(sent["VATIncluded"]!.GetValue<bool>());
        Assert.Null(sent["VATRate"]);
        Assert.Equal(b.Price, sent["Items"]![0]!["UnitPrice"]!.GetValue<decimal>());
        Assert.Equal(1, s.Sumit.Count("/website/companies/getdetails/"));
        // the account is checked once per server start, not per purchase
        await BuyAsync(s);
        Assert.Equal(1, s.Sumit.Count("/website/companies/getdetails/"));
    }

    [Fact]
    public async Task An_account_that_is_not_an_exempt_dealer_never_gets_a_payment_page()
    {
        var s = Start();
        s.Sumit.OrganizationType = 2;
        await EnsureProductAsync(s.F.Services);
        Assert.Equal((HttpStatusCode)502, (await s.Http.PostAsJsonAsync("/api/orders", new { productId = ProductId })).StatusCode);
        Assert.Equal(0, s.Sumit.Count(Begin));
    }

    [Fact]
    public async Task The_receipt_number_and_id_are_kept_and_it_is_read_once()
    {
        var s = Start();
        var b = await BuyAsync(s);
        var payment = s.Sumit.Pay(b.Id, b.Price);
        await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => ReturnAsync(s, b, payment)));
        await ReturnAsync(s, b, payment);
        var order = await s.Order(b.Id);
        Assert.Equal(s.Sumit.Payments[payment]["DocumentID"], order.ProviderDocumentId);
        Assert.Equal(40000 + order.ProviderDocumentId, order.ProviderDocumentNumber);
        Assert.Null(order.ProviderIssue);
        Assert.Equal(1, s.Sumit.Count("/accounting/documents/getdetails/"));
        Assert.DoesNotContain(s.Sumit.Calls, c => c.Path.Contains("documents/create"));
    }

    [Fact]
    public async Task A_document_that_is_not_a_receipt_is_flagged_for_the_admin()
    {
        var s = Start();
        s.Sumit.IssuedDocumentType = 1;
        var b = await BuyAsync(s);
        await ReturnAsync(s, b, s.Sumit.Pay(b.Id, b.Price));
        Assert.Equal("document-not-receipt", (await s.Order(b.Id)).ProviderIssue);
    }

    [Fact]
    public async Task A_receipt_number_that_could_not_be_read_is_completed_by_the_admin_check_without_a_new_document()
    {
        var s = Start();
        s.Sumit.DocumentsDown = true;
        var b = await BuyAsync(s);
        await ReturnAsync(s, b, s.Sumit.Pay(b.Id, b.Price));
        var before = await s.Order(b.Id);
        Assert.Equal(OrderStatus.Paid, before.Status);
        Assert.NotNull(before.ProviderDocumentId);
        Assert.Null(before.ProviderDocumentNumber);

        s.Sumit.DocumentsDown = false;
        var admin = await AdminAsync(s);
        (await admin.PostAsync($"/api/admin/orders/{b.Id}/check-payment", null)).EnsureSuccessStatusCode();
        var after = await s.Order(b.Id);
        Assert.Equal(before.ProviderDocumentId, after.ProviderDocumentId);
        Assert.Equal(40000 + after.ProviderDocumentId, after.ProviderDocumentNumber);
        Assert.DoesNotContain(s.Sumit.Calls, c => c.Path.Contains("documents/create"));
    }

    [Fact]
    public async Task A_payment_that_does_not_match_is_flagged_for_the_admin()
    {
        var s = Start();
        var b = await BuyAsync(s);
        var payment = s.Sumit.Pay(b.Id, b.Price + 15);
        await ReturnAsync(s, b, payment);
        Assert.Equal($"payment-mismatch:{payment}", (await s.Order(b.Id)).ProviderIssue);
        await AssertNotOpenableAsync(s, b);
    }

    // ------------------------------------------------------------------ the coupon's limit is never passed

    private static async Task LimitAsync(Site s, string code, int max) =>
        await s.Db(db => db.Coupons.Where(c => c.Code == code).ExecuteUpdateAsync(x => x.SetProperty(c => c.MaxRedemptions, max)));

    [Fact]
    public async Task A_coupon_use_stays_held_for_as_long_as_the_payment_page_can_be_paid()
    {
        var s = Start();
        var code = await CouponAsync(s, 10);
        await LimitAsync(s, code, 1);
        var first = await BuyAsync(s, coupon: code);
        var held = await s.Db(db => db.CouponRedemptions.AsNoTracking().SingleAsync(r => r.OrderId == first.Id));
        var order = await s.Order(first.Id);
        Assert.Equal(order.CheckoutExpiresAt!.Value + SumitReconciler.CloseGrace, held.ReservedUntil);

        // 40 minutes later (past the old 30) the use is still held, so nobody else can take it...
        await s.Db(db => db.CouponRedemptions.Where(r => r.Id == held.Id).ExecuteUpdateAsync(x => x.SetProperty(r => r.ReservedUntil, DateTime.UtcNow.AddMinutes(25))));
        Assert.Equal(HttpStatusCode.Conflict, (await s.Http.PostAsJsonAsync("/api/orders", new { productId = ProductId, couponCode = code })).StatusCode);
        // ...and the payment that arrives then takes it
        await ReturnAsync(s, first, s.Sumit.Pay(first.Id, first.Price));
        Assert.Equal(OrderStatus.Paid, (await s.Order(first.Id)).Status);
        Assert.Equal(1, await s.Db(db => db.CouponRedemptions.CountAsync(r => r.CouponId == held.CouponId && r.Status == RedemptionStatus.Redeemed)));
    }

    [Fact]
    public async Task A_payment_after_the_limit_was_reached_opens_no_game_and_never_passes_the_limit()
    {
        var s = Start();
        var code = await CouponAsync(s, 10);
        await LimitAsync(s, code, 1);
        // the first buyer cancels, which returns the use; the second buyer takes it and pays
        var first = await BuyAsync(s, coupon: code);
        await s.Http.SendAsync(WithKey(HttpMethod.Post, $"/api/orders/{first.Id}/payment-cancelled", first.Key));
        var second = await BuyAsync(s, coupon: code);
        await ReturnAsync(s, second, s.Sumit.Pay(second.Id, second.Price));
        Assert.Equal(OrderStatus.Paid, (await s.Order(second.Id)).Status);

        // the first buyer pays after all, on the page still open
        var late = s.Sumit.Pay(first.Id, first.Price);
        var view = await ReturnAsync(s, first, late);
        Assert.True(view.GetProperty("paymentNeedsRefund").GetBoolean());
        var order = await s.Order(first.Id);
        Assert.Equal($"coupon-limit:{late}", order.ProviderIssue);
        await AssertNotOpenableAsync(s, first, "cancelled");
        var couponId = order.CouponId;
        Assert.Equal(1, await s.Db(db => db.CouponRedemptions.CountAsync(r => r.CouponId == couponId && r.Status == RedemptionStatus.Redeemed)));
    }

    [Fact]
    public async Task Two_late_payments_at_once_cannot_both_take_the_last_use()
    {
        var s = Start();
        var code = await CouponAsync(s, 10);
        await LimitAsync(s, code, 2);
        var a = await BuyAsync(s, coupon: code);
        var c = await BuyAsync(s, coupon: code);
        foreach (var b in new[] { a, c }) await s.Http.SendAsync(WithKey(HttpMethod.Post, $"/api/orders/{b.Id}/payment-cancelled", b.Key));
        await LimitAsync(s, code, 1);
        await Task.WhenAll(ReturnAsync(s, a, s.Sumit.Pay(a.Id, a.Price)), ReturnAsync(s, c, s.Sumit.Pay(c.Id, c.Price)));
        var couponId = (await s.Order(a.Id)).CouponId;
        Assert.Equal(1, await s.Db(db => db.CouponRedemptions.CountAsync(r => r.CouponId == couponId && r.Status == RedemptionStatus.Redeemed)));
        Assert.Equal(1, await s.Db(db => db.Entitlements.CountAsync(e => e.OrderId == a.Id || e.OrderId == c.Id)));
    }

    // ------------------------------------------------------------------ a refund closes the game for everyone in it

    private static async Task<(Buy B, string Code, string Claim)> PaidGameAsync(Site s)
    {
        var b = await BuyAsync(s);
        await ReturnAsync(s, b, s.Sumit.Pay(b.Id, b.Price));
        var opened = await (await OpenAsync(s, b)).Content.ReadFromJsonAsync<JsonElement>(Json);
        return (b, opened.GetProperty("code").GetString()!, opened.GetProperty("hostClaim").GetString()!);
    }

    private static async Task<(HubConnection Conn, string Token, ConcurrentQueue<JsonElement> Notices)> SeatedAsync(Site s, string code, string character, string? claim)
    {
        var res = await s.Http.PostAsJsonAsync($"/api/rooms/{code}/players", new { nickname = "P" + character, characterId = character, appearance = "{}", hostClaim = claim });
        res.EnsureSuccessStatusCode();
        var token = (await res.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("token").GetString()!;
        var server = s.F.Server;
        var conn = new HubConnectionBuilder().WithUrl(new Uri(server.BaseAddress, "/hubs/game"), o =>
        {
            o.Transports = HttpTransportType.LongPolling;
            o.HttpMessageHandlerFactory = _ => server.CreateHandler();
        }).Build();
        var notices = new ConcurrentQueue<JsonElement>();
        conn.On<JsonElement>("notice", n => notices.Enqueue(n));
        await conn.StartAsync();
        Assert.True((await conn.InvokeAsync<JsonElement>("Connect", token)).GetProperty("ok").GetBoolean());
        return (conn, token, notices);
    }

    private static async Task SetPhaseAsync(Site s, string code, RoomPhase phase) =>
        await s.Db(db => db.Rooms.Where(r => r.Code == code).ExecuteUpdateAsync(x => x.SetProperty(r => r.Phase, phase)));

    [Theory]
    [InlineData(RoomPhase.Lobby)]
    [InlineData(RoomPhase.Intro)]
    [InlineData(RoomPhase.Playing)]
    public async Task A_refund_closes_a_game_that_has_not_finished_and_keeps_everything_on_record(RoomPhase phase)
    {
        var s = Start();
        var (b, code, claim) = await PaidGameAsync(s);
        var (host, hostToken, notices) = await SeatedAsync(s, code, "explorer", claim);
        await using var _ = host;
        var (guest, guestToken, _) = await SeatedAsync(s, code, "scholar", null);
        await using var __ = guest;
        await SetPhaseAsync(s, code, phase);

        var admin = await AdminAsync(s);
        (await admin.PostAsync($"/api/admin/orders/{b.Id}/mark-refunded", null)).EnsureSuccessStatusCode();
        for (var i = 0; i < 40 && notices.All(n => n.GetProperty("kind").GetString() != "refunded"); i++) await Task.Delay(100);
        Assert.Contains(notices, n => n.GetProperty("kind").GetString() == "refunded");

        // those inside cannot act, read or talk
        foreach (var call in new[] { host.InvokeAsync<JsonElement>("SetReady", true), guest.InvokeAsync<JsonElement>("GetPersonalTask"), guest.InvokeAsync<JsonElement>("SendChat", "שלום", null), host.InvokeAsync<JsonElement>("StartGame") })
            Assert.Equal(RoomService.RefundedCode, (await call).GetProperty("code").GetString());

        // nobody new enters, and a player who left cannot come back in
        var join = await s.Http.PostAsJsonAsync($"/api/rooms/{code}/players", new { nickname = "Late", characterId = "engineer", appearance = "{}" });
        Assert.Equal(HttpStatusCode.BadRequest, join.StatusCode);
        Assert.Equal(RoomService.RefundedCode, (await join.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("code").GetString());
        Assert.False((await (await s.Http.GetAsync($"/api/rooms/{code}")).Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("canJoin").GetBoolean());
        await using var again = new HubConnectionBuilder().WithUrl(new Uri(s.F.Server.BaseAddress, "/hubs/game"), o =>
        {
            o.Transports = HttpTransportType.LongPolling;
            o.HttpMessageHandlerFactory = _ => s.F.Server.CreateHandler();
        }).Build();
        await again.StartAsync();
        Assert.Equal(RoomService.RefundedCode, (await again.InvokeAsync<JsonElement>("Connect", guestToken)).GetProperty("code").GetString());

        // the buyer cannot open it again; the order, the game and both players are still there
        Assert.Equal(HttpStatusCode.Conflict, (await OpenAsync(s, b)).StatusCode);
        Assert.Equal(OrderStatus.Refunded, (await s.Order(b.Id)).Status);
        var room = await s.Db(db => db.Rooms.AsNoTracking().Include(r => r.Players).SingleAsync(r => r.Code == code));
        Assert.Equal(phase, room.Phase);
        Assert.Equal(2, room.Players.Count);
    }

    [Fact]
    public async Task A_refunded_game_that_already_finished_keeps_its_results_but_cannot_be_played_again()
    {
        var s = Start();
        var (b, code, claim) = await PaidGameAsync(s);
        var (host, hostToken, _) = await SeatedAsync(s, code, "explorer", claim);
        await SetPhaseAsync(s, code, RoomPhase.Completed);
        await host.DisposeAsync();
        var admin = await AdminAsync(s);
        (await admin.PostAsync($"/api/admin/orders/{b.Id}/mark-refunded", null)).EnsureSuccessStatusCode();

        await using var back = new HubConnectionBuilder().WithUrl(new Uri(s.F.Server.BaseAddress, "/hubs/game"), o =>
        {
            o.Transports = HttpTransportType.LongPolling;
            o.HttpMessageHandlerFactory = _ => s.F.Server.CreateHandler();
        }).Build();
        await back.StartAsync();
        Assert.True((await back.InvokeAsync<JsonElement>("Connect", hostToken)).GetProperty("ok").GetBoolean());
        Assert.Equal(RoomService.RefundedCode, (await back.InvokeAsync<JsonElement>("PlayAgain")).GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_free_room_from_the_admin_never_reaches_sumit_even_when_it_is_on()
    {
        var s = Start(production: true);
        await EnsureProductAsync(s.F.Services);
        var orders = await s.Db(db => db.Orders.CountAsync());
        var admin = await AdminAsync(s);
        var res = await admin.PostAsJsonAsync("/api/admin/free-game", new { productId = ProductId });
        res.EnsureSuccessStatusCode();
        var code = (await res.Content.ReadFromJsonAsync<JsonElement>(Json)).GetProperty("code").GetString()!;
        Assert.Empty(s.Sumit.Calls);
        Assert.Equal(orders, await s.Db(db => db.Orders.CountAsync()));
        Assert.Equal(HttpStatusCode.OK, (await s.Http.PostAsJsonAsync($"/api/rooms/{code}/players", new { nickname = "Guest", characterId = "explorer", appearance = "{}" })).StatusCode);

        // the public still pays: an order goes to the payment page
        var b = await BuyAsync(s);
        Assert.StartsWith("https://pay.sumit.test/", b.CheckoutUrl);
        await AssertNotOpenableAsync(s, b);
    }

    // ------------------------------------------------------------------ settings and secrets

    private sealed class Env(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "t";
        public string ContentRootPath { get; set; } = "";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
    }

    private static SumitOptions? Options(string env, string? key = "k", string? company = "999", string? test = null, string? site = "https://x.test") =>
        SumitOptions.FromConfig(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["SUMIT_API_KEY"] = key, ["SUMIT_COMPANY_ID"] = company, ["SUMIT_TEST_MODE"] = test,
        }).Build(), new SiteOptions { SiteUrl = site }, new Env(env), NullLogger.Instance);

    [Fact]
    public void Test_settings_can_never_reach_a_real_card_and_real_settings_can_never_run_outside_production()
    {
        Assert.Null(Options("Production", test: "true"));
        Assert.Null(Options("Staging"));
        Assert.Null(Options("Development", test: "false"));
        Assert.Null(Options("Staging", test: "true", company: SumitOptions.RealCompanyId.ToString()));
        Assert.Null(Options("Production", key: null));
        Assert.Null(Options("Production", key: "  "));
        Assert.Null(Options("Production", company: null));
        Assert.Null(Options("Production", site: "http://x.test"));
        Assert.Null(Options("Production", site: null));
        Assert.False(Options("Production")!.TestMode);
        Assert.True(Options("Staging", test: "true")!.TestMode);
    }

    [Fact]
    public async Task Without_valid_settings_purchasing_stays_closed_and_nothing_calls_sumit()
    {
        var s = Start(extra: new() { ["SUMIT_API_KEY"] = null, ["SUMIT_TEST_MODE"] = "true" });
        await EnsureProductAsync(s.F.Services);
        Assert.False(s.F.Services.GetRequiredService<PaymentGateway>().Available);
        Assert.Equal((HttpStatusCode)503, (await s.Http.PostAsJsonAsync("/api/orders", new { productId = ProductId })).StatusCode);
        Assert.Empty(s.Sumit.Calls);
    }

    [Fact]
    public async Task There_is_no_demo_route_when_sumit_is_on()
    {
        var s = Start();
        await EnsureProductAsync(s.F.Services);
        Assert.Equal(HttpStatusCode.NotFound, (await s.Http.PostAsync($"/api/products/{ProductId}/test-game", null)).StatusCode);
        var product = await (await s.Http.GetAsync($"/api/products/{ProductId}")).Content.ReadFromJsonAsync<JsonElement>(Json);
        Assert.False(product.TryGetProperty("testCheckout", out _));
    }

    [Fact]
    public async Task With_no_provider_the_new_routes_do_nothing_and_the_site_works_as_before()
    {
        var sumit = new FakeSumit();
        var f = _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Payments:Provider"] = "none",
            }));
            b.ConfigureTestServices(s => s.AddSingleton<SumitHttp>(sumit));
        });
        var http = f.CreateClient();
        await EnsureProductAsync(f.Services);
        Assert.Equal(HttpStatusCode.NotFound, (await http.PostAsync($"/api/payments/ipn/sumit/{Guid.NewGuid()}/x", new StringContent("{}"))).StatusCode);
        using (var scope = f.Services.CreateScope())
            Assert.Equal(0, await scope.ServiceProvider.GetRequiredService<SumitReconciler>().SweepAsync(DateTime.UtcNow));
        Assert.Empty(sumit.Calls);
    }

    [Fact]
    public async Task The_key_never_appears_in_logs_or_answers()
    {
        var s = Start();
        await EnsureProductAsync(s.F.Services);
        var created = await s.Http.PostAsJsonAsync("/api/orders", new { productId = ProductId });
        var text = await created.Content.ReadAsStringAsync();
        var o = JsonDocument.Parse(text).RootElement;
        var b = new Buy(o.GetProperty("orderId").GetGuid(), o.GetProperty("accessKey").GetString()!, "", o.GetProperty("price").GetDecimal());
        await ReturnAsync(s, b, s.Sumit.Pay(b.Id, b.Price));
        s.Sumit.Down = true;
        await ReturnAsync(s, b, 12345);
        var view = await (await s.Http.SendAsync(WithKey(HttpMethod.Get, $"/api/orders/{b.Id}", b.Key))).Content.ReadAsStringAsync();
        var products = await (await s.Http.GetAsync("/api/products")).Content.ReadAsStringAsync();
        Assert.DoesNotContain(ApiKey, text);
        Assert.DoesNotContain(ApiKey, view);
        Assert.DoesNotContain(ApiKey, products);
        Assert.NotEmpty(s.Logs.Lines);
        Assert.DoesNotContain(s.Logs.Lines, l => l.Contains(ApiKey));
    }
}
