using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using PortalX.Server.Data;
using PortalX.Server.Domain;

namespace PortalX.Server.Payments;

/// <summary>
/// The only way a SUMIT order becomes paid: the server asks SUMIT (payments/get) and compares the answer with the order.
/// A notification, a return address or a list row only say when and what to ask. Everything that is unclear stays unpaid.
/// </summary>
public sealed class SumitReconciler(PortalDbContext db, PurchaseService purchases, PaymentGateway gateway, ILogger<SumitReconciler> logger)
{
    /// <summary>The least time between two look-ups of one order, however many notifications and page loads ask for it.</summary>
    public static readonly TimeSpan LookupSpacing = TimeSpan.FromSeconds(20);
    /// <summary>After the link expired, one last look before the order closes.</summary>
    public static readonly TimeSpan CloseGrace = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan[] CheckpointsAfterCreation = [TimeSpan.FromMinutes(10), TimeSpan.FromMinutes(30)];
    private static readonly TimeSpan RetryOpen = TimeSpan.FromHours(1);
    private static readonly TimeSpan DateMargin = TimeSpan.FromDays(1);
    private const int MaxPagesPerLookup = 10;

    private SumitPaymentProvider? Provider => gateway.Provider as SumitPaymentProvider;

    /// <summary>Whether an open order is due for a look now. Very few per order, so an abandoned order costs at most three look-ups.</summary>
    public static bool IsDue(Order o, DateTime now)
    {
        var last = o.LastReconciledAt ?? DateTime.MinValue;
        var close = CloseAt(o);
        foreach (var at in CheckpointsAfterCreation.Select(c => o.CreatedAt + c).Append(close))
            if (now >= at && last < at) return true;
        // the last look could not finish (SUMIT unavailable, daily limit): try again, rarely
        return now >= close && now - last >= RetryOpen;
    }

    private static DateTime CloseAt(Order o) => (o.CheckoutExpiresAt ?? o.CreatedAt + TimeSpan.FromHours(1)) + CloseGrace;

    public async Task<bool> IpnMatchesAsync(Guid orderId, string session)
    {
        if (Provider == null) return false;
        var stored = await db.Orders.AsNoTracking().Where(o => o.Id == orderId && o.Provider == SumitPaymentProvider.ProviderName)
            .Select(o => o.ProviderSessionId).FirstOrDefaultAsync();
        return stored != null && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(stored), Encoding.UTF8.GetBytes(session));
    }

    /// <summary>In test mode only: the names of the fields SUMIT sends, never their values. SUMIT does not document this message.</summary>
    public async Task LogIpnShapeAsync(HttpRequest http)
    {
        if (Provider is not { IsTest: true }) return;
        using var reader = new StreamReader(http.Body);
        var body = await reader.ReadToEndAsync();
        IEnumerable<string> names;
        try
        {
            using var doc = JsonDocument.Parse(body);
            names = doc.RootElement.ValueKind == JsonValueKind.Object ? doc.RootElement.EnumerateObject().Select(p => p.Name).ToList() : [];
        }
        catch (JsonException)
        {
            names = QueryHelpers.ParseQuery(body).Keys.ToList();
        }
        logger.LogInformation("SUMIT IPN received: content type {Type}, {Length} characters, fields: {Fields}",
            http.ContentType, body.Length, string.Join(",", names));
    }

    /// <summary>The buyer came back with a payment number. It proves nothing until SUMIT confirms it for this order.</summary>
    public async Task<string> CheckPaymentIdAsync(Guid orderId, long paymentId, string source)
    {
        if (Provider is not { } provider) return "inactive";
        var order = await db.Orders.AsNoTracking().FirstOrDefaultAsync(o => o.Id == orderId && o.Provider == provider.Name);
        if (order == null) return "no-order";
        if (order.ProviderTransactionId == paymentId.ToString() && order.Status is OrderStatus.Paid or OrderStatus.Refunded) return "already";
        try
        {
            return await VerifyAsync(provider, order, paymentId, source);
        }
        catch (SumitException ex)
        {
            logger.LogWarning("Order {Number}: SUMIT check failed: {Reason}", order.Number, ex.Message);
            return "unavailable";
        }
    }

    /// <summary>Asks SUMIT whether this order has a payment. Spaced per order, so repeated calls cost nothing.</summary>
    public async Task<string> LookupAsync(Guid orderId, string source, bool spaced = true)
    {
        if (Provider is not { } provider) return "inactive";
        var order = await db.Orders.AsNoTracking().FirstOrDefaultAsync(o => o.Id == orderId && o.Provider == provider.Name);
        if (order == null) return "no-order";
        if (order.Status == OrderStatus.Refunded) return "already";
        // the admin's check also completes a document number that could not be read at the time
        if (source == "admin" && order.Status == OrderStatus.Paid && order.ProviderDocumentId is > 0 && order.ProviderDocumentNumber == null)
            await RecordDocumentAsync(provider, order, order.ProviderDocumentId.Value);
        // a paid order is looked at again only when SUMIT or the admin asks: a second payment shows up there, a page load has nothing to add
        if (order.Status == OrderStatus.Paid && source is not ("ipn" or "admin")) return "already";
        var now = DateTime.UtcNow;
        if (spaced && !await ClaimAsync(orderId, now)) return "spaced";
        try
        {
            var (payments, complete) = await ListAsync(provider, order.CreatedAt, now);
            var mine = payments.Where(p => p.ExternalIdentifier == order.Id.ToString()).Select(p => p.Id).Distinct().ToList();
            if (!spaced) await db.Orders.Where(o => o.Id == orderId).ExecuteUpdateAsync(s => s.SetProperty(o => o.LastReconciledAt, now));
            if (mine.Count == 0) return complete ? "none" : "incomplete";
            var results = new List<string>();
            foreach (var id in mine)
                results.Add(order.ProviderTransactionId == id.ToString() ? "already" : await VerifyAsync(provider, order, id, source));
            return string.Join(",", results);
        }
        catch (SumitException ex)
        {
            logger.LogWarning("Order {Number}: SUMIT look-up failed: {Reason}", order.Number, ex.Message);
            return "unavailable";
        }
    }

    /// <summary>The buyer pressed cancel on SUMIT's page. Closed only after SUMIT shows no payment; a later payment still counts.</summary>
    public async Task<string> BuyerCancelledAsync(Guid orderId)
    {
        if (Provider == null || !await db.Orders.AnyAsync(o => o.Id == orderId && o.Status == OrderStatus.Pending)) return "ignored";
        var result = await LookupAsync(orderId, "cancel", spaced: false);
        if (result != "none") return result;
        var order = await db.Orders.AsNoTracking().FirstAsync(o => o.Id == orderId);
        return order.Status == OrderStatus.Pending ? await CloseAsync(order, "cancel") : result;
    }

    /// <summary>The periodic check: one list call for all the orders due, no call at all when none is due.</summary>
    public async Task<int> SweepAsync(DateTime now)
    {
        if (Provider is not { } provider) return 0;
        var open = await db.Orders.AsNoTracking()
            .Where(o => o.Provider == provider.Name && o.Status == OrderStatus.Pending)
            .OrderBy(o => o.CreatedAt).Take(200).ToListAsync();
        var due = open.Where(o => IsDue(o, now)).ToList();
        if (due.Count == 0) return 0;
        List<SumitPayment> payments;
        bool complete;
        try
        {
            (payments, complete) = await ListAsync(provider, due.Min(o => o.CreatedAt), now);
        }
        catch (SumitException ex)
        {
            logger.LogWarning("SUMIT sweep failed: {Reason}", ex.Message);
            return 0;
        }
        var ids = due.Select(o => o.Id).ToList();
        await db.Orders.Where(o => ids.Contains(o.Id)).ExecuteUpdateAsync(s => s.SetProperty(o => o.LastReconciledAt, now));
        foreach (var order in due)
        {
            var mine = payments.Where(p => p.ExternalIdentifier == order.Id.ToString()).Select(p => p.Id).Distinct().ToList();
            try
            {
                foreach (var id in mine) await VerifyAsync(provider, order, id, "sweep");
                if (mine.Count == 0 && complete && now >= CloseAt(order)) await CloseAsync(order, "expired");
            }
            catch (SumitException ex)
            {
                logger.LogWarning("Order {Number}: SUMIT sweep check failed: {Reason}", order.Number, ex.Message);
            }
        }
        return due.Count;
    }

    private async Task<bool> ClaimAsync(Guid orderId, DateTime now)
    {
        var before = now - LookupSpacing;
        return await db.Orders.Where(o => o.Id == orderId && (o.LastReconciledAt == null || o.LastReconciledAt < before))
            .ExecuteUpdateAsync(s => s.SetProperty(o => o.LastReconciledAt, now)) > 0;
    }

    private static async Task<(List<SumitPayment> Payments, bool Complete)> ListAsync(SumitPaymentProvider provider, DateTime from, DateTime now)
    {
        var all = new List<SumitPayment>();
        for (var page = 0; page < MaxPagesPerLookup; page++)
        {
            // the margin covers any time zone SUMIT may use for these dates; orders are matched by their identifier
            var result = await provider.Client.ListValidPaymentsAsync(from - DateMargin, now + DateMargin, all.Count);
            all.AddRange(result.Payments);
            if (!result.HasNextPage) return (all, true);
            if (result.Payments.Count == 0) return (all, false);
        }
        return (all, false);
    }

    /// <summary>The one place a payment is accepted. Anything that does not match leaves the order as it is.</summary>
    private async Task<string> VerifyAsync(SumitPaymentProvider provider, Order order, long paymentId, string source)
    {
        var payment = await provider.Client.GetPaymentAsync(paymentId);
        if (payment == null || payment.Id != paymentId) return "not-found";
        if (payment.ExternalIdentifier != order.Id.ToString())
        {
            logger.LogWarning("Order {Number}: payment {Payment} belongs to another order; refused", order.Number, paymentId);
            return "rejected:other-order";
        }
        if (!payment.Valid) return "not-valid";
        var result = await purchases.ApplyAsync(provider, new PaymentNotification(
            $"pay:{paymentId}", PaymentEventType.Succeeded, order.ProviderSessionId ?? "", order.Id, paymentId.ToString(),
            payment.Amount, payment.Currency ?? "", provider.IsTest,
            new VerifiedPayment(payment.CustomerId, payment.DocumentId, payment.AuthNumber), source));
        if (result == "applied:paid" && payment.DocumentId is > 0) await RecordDocumentAsync(provider, order, payment.DocumentId.Value);
        // money was taken but it does not match the order: the game stays closed and the admin must look at it
        if (result.StartsWith("rejected"))
            await db.Orders.Where(o => o.Id == order.Id && o.ProviderIssue == null)
                .ExecuteUpdateAsync(s => s.SetProperty(o => o.ProviderIssue, "payment-mismatch:" + paymentId));
        return result;
    }

    /// <summary>Reads the number of the document SUMIT issued. A failure here never touches the payment.</summary>
    private async Task RecordDocumentAsync(SumitPaymentProvider provider, Order order, long documentId)
    {
        try
        {
            var document = await provider.Client.GetDocumentAsync(documentId);
            await db.Orders.Where(o => o.Id == order.Id).ExecuteUpdateAsync(s => s
                .SetProperty(o => o.ProviderDocumentNumber, document.Number)
                .SetProperty(o => o.ProviderIssue, o => document.IsDraft == true ? "document-draft" : !document.IsReceipt ? "document-not-receipt" : o.ProviderIssue));
        }
        catch (SumitException ex)
        {
            logger.LogWarning("Order {Number}: could not read document {Document}: {Reason}", order.Number, documentId, ex.Message);
        }
    }

    private async Task<string> CloseAsync(Order order, string source) =>
        await purchases.ApplyAsync(Provider!, new PaymentNotification(
            $"closed:{order.Id}", PaymentEventType.Cancelled, order.ProviderSessionId ?? "", order.Id, null,
            order.PriceSnapshot, order.Currency, Provider!.IsTest, Source: source));
}

/// <summary>Runs the periodic check while the server is awake. With any other provider it does nothing at all.</summary>
public sealed class SumitReconciliationService(IServiceScopeFactory scopes, PaymentGateway gateway, ILogger<SumitReconciliationService> logger) : BackgroundService
{
    private static readonly TimeSpan Period = TimeSpan.FromMinutes(5);

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        if (gateway.Provider is not SumitPaymentProvider) return;
        await Task.Delay(TimeSpan.FromMinutes(1), stop).ContinueWith(_ => { });
        while (!stop.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                await scope.ServiceProvider.GetRequiredService<SumitReconciler>().SweepAsync(DateTime.UtcNow);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning("SUMIT periodic check failed ({Type})", ex.GetType().Name);
            }
            await Task.Delay(Period, stop).ContinueWith(_ => { });
        }
    }
}
