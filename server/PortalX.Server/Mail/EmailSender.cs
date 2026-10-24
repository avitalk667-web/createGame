using System.Net;
using System.Net.Mail;
using System.Text;

namespace PortalX.Server.Mail;

public sealed record EmailMessage(string To, string Subject, string Html, string Text, string? UnsubscribeUrl = null);

/// <summary>Why a message could not be sent; <see cref="Transient"/> failures may succeed on a later try.</summary>
public sealed class EmailSendException(string code, bool transient, Exception? inner = null) : Exception(code, inner)
{
    public string Code { get; } = code;
    public bool Transient { get; } = transient;
}

/// <summary>Sends one email from the server (never from the browser). Throws <see cref="EmailSendException"/>.</summary>
public interface IEmailSender
{
    bool Available { get; }
    Task SendAsync(EmailMessage message, CancellationToken ct = default);
}

/// <summary>Used while no SMTP server is configured: nothing is sent, and callers say so honestly.</summary>
public sealed class UnconfiguredEmailSender : IEmailSender
{
    public bool Available => false;
    public Task SendAsync(EmailMessage message, CancellationToken ct = default) => throw new EmailSendException("not-configured", false);
}

/// <summary>SMTP with STARTTLS (e.g. Gmail with an App Password). Replaceable by another provider behind the same interface.</summary>
public sealed class SmtpEmailSender(SmtpOptions options, ILogger<SmtpEmailSender> logger) : IEmailSender
{
    public bool Available => options.Configured;

    public async Task SendAsync(EmailMessage m, CancellationToken ct = default)
    {
        using var mail = new MailMessage
        {
            From = new MailAddress(options.FromEmail, options.FromName, Encoding.UTF8),
            Subject = m.Subject,
            SubjectEncoding = Encoding.UTF8,
            BodyEncoding = Encoding.UTF8,
            HeadersEncoding = Encoding.UTF8,
        };
        mail.To.Add(new MailAddress(m.To));
        mail.ReplyToList.Add(new MailAddress(options.ReplyTo, options.FromName, Encoding.UTF8));
        if (m.UnsubscribeUrl != null)
        {
            mail.Headers.Add("List-Unsubscribe", $"<{m.UnsubscribeUrl}>");
        }
        // a plain text part for clients that block HTML, and the designed HTML part
        mail.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(m.Text, Encoding.UTF8, "text/plain"));
        mail.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(m.Html, Encoding.UTF8, "text/html"));

        using var client = new SmtpClient(options.Host, options.Port)
        {
            EnableSsl = options.UseTls,
            DeliveryMethod = SmtpDeliveryMethod.Network,
            Timeout = 20000,
        };
        if (!string.IsNullOrEmpty(options.Username))
            client.Credentials = new NetworkCredential(options.Username, options.Password);
        try
        {
            await client.SendMailAsync(mail, ct);
        }
        catch (SmtpFailedRecipientException ex)
        {
            // the address itself was refused: trying again will not help
            logger.LogWarning("SMTP refused a recipient ({Status})", ex.StatusCode);
            throw new EmailSendException("recipient-refused", false, ex);
        }
        catch (SmtpException ex)
        {
            var transient = ex.StatusCode is SmtpStatusCode.ServiceNotAvailable or SmtpStatusCode.MailboxBusy
                or SmtpStatusCode.InsufficientStorage or SmtpStatusCode.LocalErrorInProcessing or SmtpStatusCode.GeneralFailure
                or SmtpStatusCode.TransactionFailed or SmtpStatusCode.ServiceClosingTransmissionChannel;
            var auth = ex.StatusCode is SmtpStatusCode.ClientNotPermitted or SmtpStatusCode.MustIssueStartTlsFirst
                || ex.Message.Contains("Authentication", StringComparison.OrdinalIgnoreCase);
            // logs carry the status only — never the address, the password or the server's full reply
            logger.LogWarning("SMTP send failed ({Status}, transient={Transient})", ex.StatusCode, transient && !auth);
            throw new EmailSendException(auth ? "smtp-auth" : "smtp-error", transient && !auth, ex);
        }
        catch (Exception ex) when (ex is IOException or System.Net.Sockets.SocketException or TimeoutException or OperationCanceledException)
        {
            logger.LogWarning("SMTP connection failed ({Type})", ex.GetType().Name);
            throw new EmailSendException("smtp-unreachable", true, ex);
        }
    }
}
