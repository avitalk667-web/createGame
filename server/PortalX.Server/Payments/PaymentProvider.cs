using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using PortalX.Server.Domain;

namespace PortalX.Server.Payments;

public sealed class PaymentOptions
{
    /// <summary>"none" (default) or "sandbox". A real Israeli provider is added here later.</summary>
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

/// <summary>A payment notification after its signature was verified by the provider.</summary>
public sealed record PaymentNotification(
    string EventId, PaymentEventType Type, string SessionId, Guid OrderId, string? TransactionId,
    decimal Amount, string Currency, bool IsTest);

public sealed class InvalidWebhookException(string message) : Exception(message);

/// <summary>A payment provider: hosted checkout page + signed server-to-server notifications.</summary>
public interface IPaymentProvider
{
    string Name { get; }
    /// <summary>Test providers never create revenue and never unlock games in production.</summary>
    bool IsTest { get; }
    CheckoutSession CreateCheckout(Order order);
    /// <summary>Verifies the signature and parses the body. Throws <see cref="InvalidWebhookException"/>.</summary>
    PaymentNotification ParseWebhook(string body, IHeaderDictionary headers);
}

/// <summary>Which provider is active. Null provider = purchasing is closed.</summary>
public sealed class PaymentGateway(IPaymentProvider? provider)
{
    public IPaymentProvider? Provider { get; } = provider;
    public bool Available => Provider != null;

    public static PaymentGateway Create(PaymentOptions options, IHostEnvironment env, ILogger logger)
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

    public CheckoutSession CreateCheckout(Order order)
    {
        var session = "sbx_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        return new CheckoutSession(session, "/sandbox-pay/" + session);
    }

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
