using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using PortalX.Server.Domain;

namespace PortalX.Server.Payments;

public sealed class PaymentOptions
{
    /// <summary>"none" (default), "sandbox" or "sumit". SUMIT's own settings come from the environment (see <see cref="SumitOptions"/>).</summary>
    public string Provider { get; set; } = "none";
    public SandboxOptions Sandbox { get; set; } = new();
}

public sealed class SandboxOptions
{
    /// <summary>HMAC secret for sandbox webhooks. If empty, a random one is generated at startup.</summary>
    public string WebhookSecret { get; set; } = "";
}

public sealed record CheckoutSession(string SessionId, string CheckoutUrl);

public enum PaymentEventType { Succeeded, Failed, Cancelled, Refunded }

/// <summary>What the provider itself reported about a payment when asked server to server. Never any card details.</summary>
public sealed record VerifiedPayment(long? CustomerId, long? DocumentId, string? AuthNumber);

/// <summary>A payment notification after its signature, or the provider's own answer, was verified.</summary>
public sealed record PaymentNotification(
    string EventId, PaymentEventType Type, string SessionId, Guid OrderId, string? TransactionId,
    decimal Amount, string Currency, bool IsTest, VerifiedPayment? Verified = null, string? Source = null);

public sealed class InvalidWebhookException(string message) : Exception(message);

/// <summary>The provider could not open a payment page. Nothing was charged. The message is safe to log.</summary>
public sealed class PaymentStartException(string message) : Exception(message);

/// <summary>A payment provider: hosted checkout page + signed server-to-server notifications.</summary>
public interface IPaymentProvider
{
    string Name { get; }
    /// <summary>Test providers never create revenue and never unlock games in production.</summary>
    bool IsTest { get; }
    /// <summary>How long a payment link lasts, for providers whose links expire.</summary>
    TimeSpan? CheckoutLifetime => null;
    /// <summary>A fresh identifier for an order, fixed before the order is saved.</summary>
    string NewSessionId();
    /// <summary>Opens the payment page of a saved order. Throws <see cref="PaymentStartException"/> when it cannot.</summary>
    Task<CheckoutSession> CreateCheckoutAsync(Order order);
    /// <summary>Verifies the signature and parses the body. Throws <see cref="InvalidWebhookException"/>.</summary>
    PaymentNotification ParseWebhook(string body, IHeaderDictionary headers);
}

/// <summary>Which provider is active. Null provider = purchasing is closed.</summary>
public sealed class PaymentGateway(IPaymentProvider? provider)
{
    public IPaymentProvider? Provider { get; } = provider;
    public bool Available => Provider != null;

    public static PaymentGateway Create(PaymentOptions options, IHostEnvironment env, ILogger logger, Func<IPaymentProvider?>? sumit = null)
    {
        switch (options.Provider.Trim().ToLowerInvariant())
        {
            case "sandbox" when env.IsProduction():
                // spec: no fake payment mechanism in production
                logger.LogCritical("Payments:Provider=sandbox is refused in Production. Purchasing stays closed.");
                return new PaymentGateway(null);
            case "sandbox":
                logger.LogWarning("TEST PAYMENTS: the sandbox provider is active. No money is charged and nothing counts as revenue.");
                return new PaymentGateway(new SandboxPaymentProvider(options.Sandbox));
            case "sumit":
                // SumitOptions.FromConfig already logged why, when the settings are refused
                return new PaymentGateway(sumit?.Invoke());
            case "" or "none":
                return new PaymentGateway(null);
            default:
                logger.LogCritical("Unknown payment provider '{Provider}'. Purchasing stays closed.", options.Provider);
                return new PaymentGateway(null);
        }
    }
}

/// <summary>
/// Test-only provider. Its checkout page is part of this site (/sandbox-pay/{session}); the buyer's choice there is
/// turned into a webhook signed exactly like a real provider's, and goes through the same verification.
/// </summary>
public sealed class SandboxPaymentProvider : IPaymentProvider
{
    public const string SignatureHeader = "X-Sandbox-Signature";
    private readonly byte[] _secret;

    public SandboxPaymentProvider(SandboxOptions options) =>
        _secret = string.IsNullOrWhiteSpace(options.WebhookSecret)
            ? RandomNumberGenerator.GetBytes(32)
            : Encoding.UTF8.GetBytes(options.WebhookSecret);

    public string Name => "sandbox";
    public bool IsTest => true;

    public string NewSessionId() => "sbx_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

    public Task<CheckoutSession> CreateCheckoutAsync(Order order) =>
        Task.FromResult(new CheckoutSession(order.ProviderSessionId!, "/sandbox-pay/" + order.ProviderSessionId));

    public string Sign(string body) => "sha256=" + Convert.ToHexString(HMACSHA256.HashData(_secret, Encoding.UTF8.GetBytes(body))).ToLowerInvariant();

    /// <summary>Builds the notification body the sandbox "sends" for an order.</summary>
    public static string BuildBody(Order order, PaymentEventType type, string? transactionId) => JsonSerializer.Serialize(new
    {
        eventId = "evt_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(12)).ToLowerInvariant(),
        type = type.ToString().ToLowerInvariant(),
        sessionId = order.ProviderSessionId,
        orderId = order.Id,
        transactionId,
        amount = order.PriceSnapshot,
        currency = order.Currency,
        test = true,
    });

    public PaymentNotification ParseWebhook(string body, IHeaderDictionary headers)
    {
        var given = headers[SignatureHeader].ToString();
        var expected = Sign(body);
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(given), Encoding.ASCII.GetBytes(expected)))
            throw new InvalidWebhookException("bad signature");
        try
        {
            using var doc = JsonDocument.Parse(body);
            var r = doc.RootElement;
            var type = r.GetProperty("type").GetString() switch
            {
                "succeeded" => PaymentEventType.Succeeded,
                "failed" => PaymentEventType.Failed,
                "cancelled" => PaymentEventType.Cancelled,
                "refunded" => PaymentEventType.Refunded,
                var t => throw new InvalidWebhookException("unknown type " + t),
            };
            return new PaymentNotification(
                r.GetProperty("eventId").GetString() ?? throw new InvalidWebhookException("no event id"),
                type,
                r.GetProperty("sessionId").GetString() ?? "",
                r.GetProperty("orderId").GetGuid(),
                r.TryGetProperty("transactionId", out var tx) && tx.ValueKind == JsonValueKind.String ? tx.GetString() : null,
                r.GetProperty("amount").GetDecimal(),
                r.GetProperty("currency").GetString() ?? "",
                r.GetProperty("test").GetBoolean());
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or FormatException or InvalidOperationException)
        {
            throw new InvalidWebhookException("malformed body");
        }
    }
}
