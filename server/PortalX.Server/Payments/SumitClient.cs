using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using PortalX.Server.Domain;
using PortalX.Server.Mail;

namespace PortalX.Server.Payments;

/// <summary>
/// SUMIT's settings, read only from the environment. The private key never goes into Git, logs or the browser.
/// Real payments run only in Production and test payments only outside it, so a test can never charge a real card.
/// </summary>
public sealed class SumitOptions
{
    /// <summary>The real organization: never used in test mode, whatever the settings say.</summary>
    public const long RealCompanyId = 2561203971;
    /// <summary>The business is an exempt dealer: every payment gets a receipt, never a tax invoice.</summary>
    public const int ReceiptDocumentType = 2;
    public const int DefaultDailyCheckLimitTest = 40;
    public const int DefaultDailyCheckLimitReal = 1000;

    /// <summary>Whether SUMIT's organization type is an exempt dealer. An answer that cannot be read is not one.</summary>
    public static bool IsVatExempt(string? companyType) => companyType is "1" or "VATExemptDealer" or "VATExemptDealer (1)";

    public required long CompanyId { get; init; }
    public required string ApiKey { get; init; }
    public required string SiteUrl { get; init; }
    public bool TestMode { get; init; }
    public int DailyCheckLimit { get; init; }

    public static SumitOptions? FromConfig(IConfiguration c, SiteOptions site, IHostEnvironment env, ILogger logger)
    {
        SumitOptions? Refuse(string why)
        {
            logger.LogCritical("The SUMIT provider stays off: {Reason}. Purchasing stays closed.", why);
            return null;
        }
        var key = c["SUMIT_API_KEY"]?.Trim();
        if (string.IsNullOrEmpty(key)) return Refuse("SUMIT_API_KEY is missing");
        if (!long.TryParse(c["SUMIT_COMPANY_ID"], out var companyId) || companyId <= 0) return Refuse("SUMIT_COMPANY_ID is missing or invalid");
        if (site.SiteUrl == null || !site.SiteUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return Refuse("PORTALX_SITE_URL must be an https address");
        var test = string.Equals(c["SUMIT_TEST_MODE"]?.Trim(), "true", StringComparison.OrdinalIgnoreCase);
        if (test && env.IsProduction()) return Refuse("SUMIT_TEST_MODE is refused in Production");
        if (!test && !env.IsProduction()) return Refuse("real payments run only in Production; set SUMIT_TEST_MODE=true");
        if (test && companyId == RealCompanyId) return Refuse("test mode cannot use the real organization");
        var limit = int.TryParse(c["SUMIT_DAILY_CHECK_LIMIT"], out var l) && l > 0 ? l : test ? DefaultDailyCheckLimitTest : DefaultDailyCheckLimitReal;
        if (test) logger.LogWarning("SUMIT TEST MODE: orders are marked as tests and nothing counts as revenue.");
        return new SumitOptions { CompanyId = companyId, ApiKey = key, SiteUrl = site.SiteUrl, TestMode = test, DailyCheckLimit = limit };
    }
}

/// <summary>The connection to SUMIT (replaced with a fake in tests).</summary>
public class SumitHttp
{
    private readonly Lazy<HttpMessageHandler> _handler = new(() => new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(5) });
    public virtual HttpMessageHandler Handler => _handler.Value;
}

/// <summary>A call to SUMIT that failed. The message never contains the key or a request body.</summary>
public class SumitException(string message) : Exception(message);

/// <summary>The daily limit of checks was reached, so SUMIT was not called.</summary>
public sealed class SumitLimitException() : SumitException("the daily limit of SUMIT checks was reached");

/// <summary>A safety limit on read calls, counted per UTC day. Opening a payment page is never limited.</summary>
public sealed class SumitCallBudget(int dailyLimit)
{
    private readonly object _gate = new();
    private DateOnly _day;
    private int _used;

    public int Used { get { lock (_gate) return _used; } }

    public bool TryTake()
    {
        lock (_gate)
        {
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            if (today != _day) (_day, _used) = (today, 0);
            if (_used >= dailyLimit) return false;
            _used++;
            return true;
        }
    }
}

/// <summary>The fields of a SUMIT payment that this site uses. Currency is "ILS" only when SUMIT clearly said so.</summary>
public sealed record SumitPayment(long Id, bool Valid, decimal Amount, string? Currency, string? ExternalIdentifier,
    long? CustomerId, long? DocumentId, string? AuthNumber);

public sealed record SumitPaymentPage(List<SumitPayment> Payments, bool HasNextPage);

public sealed record SumitDocument(long? Number, bool? IsDraft, bool IsReceipt);

/// <summary>
/// The calls this site makes to SUMIT. There is deliberately no call that creates a document: SUMIT issues one
/// automatically with each payment, so a second one could only be a duplicate.
/// </summary>
public sealed class SumitClient(SumitOptions options, SumitHttp http, ILogger logger)
{
    public const string BaseUrl = "https://api.sumit.co.il";
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(20);
    private readonly SumitCallBudget _budget = new(options.DailyCheckLimit);

    public SumitCallBudget Budget => _budget;

    public async Task<string> BeginRedirectAsync(JsonObject request)
    {
        var data = await PostAsync("/billing/payments/beginredirect/", request);
        return data.TryGetProperty("RedirectURL", out var url) && url.ValueKind == JsonValueKind.String && url.GetString() is { Length: > 0 } s
            ? s : throw new SumitException("no payment page address in the answer");
    }

    /// <summary>The organization this key belongs to. Read-only; called once per server start and by the admin's check.</summary>
    public async Task<(string? Name, string? Type)> GetCompanyAsync()
    {
        var data = await PostAsync("/website/companies/getdetails/", new JsonObject());
        if (!data.TryGetProperty("Company", out var c) || c.ValueKind != JsonValueKind.Object) throw new SumitException("no organization in the answer");
        return (ReadString(c, "Name"), c.TryGetProperty("CompanyType", out var t) ? t.ToString() : null);
    }

    /// <summary>One payment, or null when SUMIT says it does not know it.</summary>
    public async Task<SumitPayment?> GetPaymentAsync(long paymentId)
    {
        Spend();
        try
        {
            var data = await PostAsync("/billing/payments/get/", new JsonObject { ["PaymentID"] = paymentId });
            return data.TryGetProperty("Payment", out var p) && p.ValueKind == JsonValueKind.Object ? ReadPayment(p) : null;
        }
        catch (SumitRefusedException)
        {
            return null;
        }
    }

    /// <summary>Valid payments in a date range, one page. The range is wide on purpose: orders are matched by their identifier.</summary>
    public async Task<SumitPaymentPage> ListValidPaymentsAsync(DateTime from, DateTime to, int startIndex)
    {
        Spend();
        var data = await PostAsync("/billing/payments/list/", new JsonObject
        {
            ["Date_From"] = from.ToString("yyyy-MM-ddTHH:mm:ssZ"),
            ["Date_To"] = to.ToString("yyyy-MM-ddTHH:mm:ssZ"),
            ["Valid"] = true,
            ["StartIndex"] = startIndex,
        });
        var list = data.TryGetProperty("Payments", out var items) && items.ValueKind == JsonValueKind.Array
            ? items.EnumerateArray().Select(ReadPayment).ToList()
            : throw new SumitException("no payment list in the answer");
        return new SumitPaymentPage(list, data.TryGetProperty("HasNextPage", out var more) && more.ValueKind == JsonValueKind.True);
    }

    /// <summary>The number and draft state of a document. Its download address is not kept or opened: SUMIT marks the first opening as the original.</summary>
    public async Task<SumitDocument> GetDocumentAsync(long documentId)
    {
        Spend();
        var data = await PostAsync("/accounting/documents/getdetails/", new JsonObject { ["DocumentID"] = documentId });
        bool? draft = data.TryGetProperty("Document", out var d) && d.ValueKind == JsonValueKind.Object && d.TryGetProperty("IsDraft", out var isDraft)
            ? isDraft.ValueKind switch { JsonValueKind.True => true, JsonValueKind.False => false, _ => null } : null;
        var type = data.TryGetProperty("Document", out var dt) && dt.ValueKind == JsonValueKind.Object && dt.TryGetProperty("Type", out var t) ? t.ToString() : null;
        return new SumitDocument(ReadLong(data, "DocumentNumber"), draft, type is "2" or "Receipt" or "Receipt (2)");
    }

    private void Spend()
    {
        if (!_budget.TryTake())
        {
            logger.LogWarning("SUMIT check skipped: the daily limit of {Limit} was reached", options.DailyCheckLimit);
            throw new SumitLimitException();
        }
    }

    private sealed class SumitRefusedException(string message) : SumitException(message);

    private async Task<JsonElement> PostAsync(string path, JsonObject body)
    {
        body["Credentials"] = new JsonObject { ["CompanyID"] = options.CompanyId, ["APIKey"] = options.ApiKey };
        using var client = new HttpClient(http.Handler, disposeHandler: false) { Timeout = RequestTimeout };
        using var content = new StringContent(body.ToJsonString(), Encoding.UTF8);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        HttpResponseMessage response;
        try
        {
            response = await client.PostAsync(BaseUrl + path, content);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            throw new SumitException($"{path}: no answer ({ex.GetType().Name})");
        }
        using (response)
        {
            if (!response.IsSuccessStatusCode) throw new SumitException($"{path}: HTTP {(int)response.StatusCode}");
            JsonDocument doc;
            try
            {
                doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            }
            catch (JsonException)
            {
                throw new SumitException($"{path}: the answer is not JSON");
            }
            using (doc)
            {
                var root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object) throw new SumitException($"{path}: unexpected answer");
                var status = ReadStatus(root);
                logger.LogInformation("SUMIT call {Path}: status {Status}", path, status);
                if (status == 1) throw new SumitRefusedException($"{path}: refused: {Message(root)}");
                if (status != 0) throw new SumitException($"{path}: status {status}: {Message(root)}");
                return root.TryGetProperty("Data", out var data) && data.ValueKind == JsonValueKind.Object
                    ? data.Clone() : throw new SumitException($"{path}: no data in the answer");
            }
        }
    }

    /// <summary>SUMIT's answer status as a number; the API sends a number, its specification shows "Success (0)". Anything else is not a success.</summary>
    private static int ReadStatus(JsonElement root)
    {
        if (!root.TryGetProperty("Status", out var s)) return -1;
        if (s.ValueKind == JsonValueKind.Number && s.TryGetInt32(out var n)) return n;
        return s.ValueKind == JsonValueKind.String ? s.GetString() switch
        {
            "Success" or "Success (0)" => 0,
            "BusinessError" or "BusinessError (1)" => 1,
            "TechnicalError" or "TechnicalError (2)" => 2,
            _ => -1,
        } : -1;
    }

    private string Message(JsonElement root) =>
        (root.TryGetProperty("UserErrorMessage", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() ?? "" : "").Replace(options.ApiKey, "***");

    private static SumitPayment ReadPayment(JsonElement p) => new(
        ReadLong(p, "ID") ?? 0,
        // only an explicit true is a valid payment
        p.TryGetProperty("ValidPayment", out var v) && v.ValueKind == JsonValueKind.True,
        p.TryGetProperty("Amount", out var a) && a.ValueKind == JsonValueKind.Number ? a.GetDecimal() : 0,
        ReadCurrency(p),
        ReadString(p, "ExternalIdentifier"),
        ReadLong(p, "CustomerID"),
        ReadLong(p, "DocumentID"),
        ReadString(p, "AuthNumber"));

    private static string? ReadCurrency(JsonElement p)
    {
        if (!p.TryGetProperty("Currency", out var c)) return null;
        if (c.ValueKind == JsonValueKind.Number) return c.TryGetInt32(out var n) && n == 0 ? "ILS" : c.GetRawText();
        return c.ValueKind == JsonValueKind.String ? c.GetString() is "ILS" or "ILS (0)" ? "ILS" : c.GetString() : null;
    }

    private static long? ReadLong(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) ? n : null;

    private static string? ReadString(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

/// <summary>
/// Checks the keys and the connection from the server itself, whether or not the provider is active.
/// Only reads: nothing is charged, and no customer, document or payment page is created.
/// </summary>
public static class SumitConnectionCheck
{
    public static async Task<object> RunAsync(IConfiguration config, SiteOptions site, IHostEnvironment env, SumitHttp http, PaymentGateway gateway, ILogger logger)
    {
        var providerActive = gateway.Provider is SumitPaymentProvider;
        if (SumitOptions.FromConfig(config, site, env, logger) is not { } options)
            return new { configured = false, providerActive, connected = false, billing = false, vatExempt = false };
        var client = new SumitClient(options, http, logger);
        string? organization = null, organizationType = null, problem = null;
        var connected = false;
        var billing = false;
        int? paymentsLastDay = null;
        try
        {
            (organization, organizationType) = await client.GetCompanyAsync();
            connected = true;
            var now = DateTime.UtcNow;
            paymentsLastDay = (await client.ListValidPaymentsAsync(now.AddDays(-1), now, 0)).Payments.Count;
            billing = true;
        }
        catch (SumitException ex)
        {
            problem = ex.Message;
        }
        return new { configured = true, providerActive, testMode = options.TestMode, connected, billing, vatExempt = SumitOptions.IsVatExempt(organizationType), organization, organizationType, paymentsLastDay, problem };
    }
}

/// <summary>SUMIT's hosted payment page: no card details ever reach this site, and the document is issued by SUMIT itself.</summary>
public sealed class SumitPaymentProvider(SumitOptions options, SumitClient client) : IPaymentProvider
{
    public const string ProviderName = "sumit";

    public static SumitPaymentProvider? TryCreate(IConfiguration config, SiteOptions site, IHostEnvironment env, SumitHttp http, ILogger logger) =>
        SumitOptions.FromConfig(config, site, env, logger) is { } options ? new SumitPaymentProvider(options, new SumitClient(options, http, logger)) : null;

    public SumitClient Client => client;
    public string Name => ProviderName;
    public bool IsTest => options.TestMode;
    /// <summary>The shortest life SUMIT allows a payment link.</summary>
    public TimeSpan? CheckoutLifetime => TimeSpan.FromHours(1);

    public string NewSessionId() => "sm_" + Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

    private volatile bool _organizationChecked;

    public async Task<CheckoutSession> CreateCheckoutAsync(Order order)
    {
        if (order.Currency != "ILS") throw new PaymentStartException($"unsupported currency {order.Currency}");
        try
        {
            // the account itself must be an exempt dealer; a request for a receipt alone is not relied on
            if (!_organizationChecked)
            {
                var (_, type) = await client.GetCompanyAsync();
                if (!SumitOptions.IsVatExempt(type)) throw new PaymentStartException("the SUMIT organization is not an exempt dealer");
                _organizationChecked = true;
            }
            var url = await client.BeginRedirectAsync(BuildRequest(order));
            if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
                throw new PaymentStartException("the payment page address is not https");
            return new CheckoutSession(order.ProviderSessionId!, url);
        }
        catch (SumitException ex)
        {
            throw new PaymentStartException(ex.Message);
        }
    }

    /// <summary>The request for the hosted page. The amount is the order's frozen price; the browser has no say in any field here.</summary>
    public JsonObject BuildRequest(Order order)
    {
        var request = new JsonObject
        {
            // SUMIT requires a customer name; the site does not ask for one
            ["Customer"] = new JsonObject { ["Name"] = $"לקוח PORTAL X, הזמנה {order.Number}" },
            ["Items"] = new JsonArray(new JsonObject
            {
                ["Item"] = new JsonObject { ["Name"] = order.ProductName, ["ExternalIdentifier"] = order.ProductId },
                ["Quantity"] = 1,
                ["UnitPrice"] = order.PriceSnapshot,
            }),
            // the site's price is the final price: nothing is ever added on top of it
            ["VATIncluded"] = true,
            ["DocumentType"] = SumitOptions.ReceiptDocumentType,
            ["RedirectURL"] = $"{options.SiteUrl}/checkout/{order.Id}",
            ["CancelRedirectURL"] = $"{options.SiteUrl}/checkout/{order.Id}/cancelled",
            ["IPNURL"] = $"{options.SiteUrl}/api/payments/ipn/sumit/{order.Id}/{order.ProviderSessionId}",
            ["ExternalIdentifier"] = order.Id.ToString(),
            ["MaximumPayments"] = 0,
            ["ExpirationHours"] = (int)CheckoutLifetime!.Value.TotalHours,
            ["DraftDocument"] = false,
            ["PreventSavingPaymentMethod"] = true,
            ["DocumentDescription"] = $"PORTAL X, הזמנה {order.Number}",
        };
        if (order.Email != null)
        {
            request["Customer"]!["EmailAddress"] = order.Email;
            request["UpdateCustomerOnSuccess"] = true;
        }
        return request;
    }

    /// <summary>SUMIT documents no signature, so a notification addressed to this provider can never prove a payment.</summary>
    public PaymentNotification ParseWebhook(string body, IHeaderDictionary headers) => throw new InvalidWebhookException("bad signature");
}
