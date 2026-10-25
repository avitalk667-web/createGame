namespace PortalX.Server.Mail;

public sealed record EmailMessage(string To, string Subject, string Html, string Text, string? UnsubscribeUrl = null);

/// <summary>
/// Why a message could not be sent. <see cref="Transient"/> failures may succeed on a later try;
/// <see cref="Uncertain"/> means the request may have reached the provider (the connection broke after sending),
/// so it is never retried automatically.
/// </summary>
public sealed class EmailSendException(string code, bool transient, Exception? inner = null, bool uncertain = false) : Exception(code, inner)
{
    public string Code { get; } = code;
    public bool Transient { get; } = transient;
    public bool Uncertain { get; } = uncertain;
}

/// <summary>Sends one email from the server (never from the browser). Throws <see cref="EmailSendException"/>.</summary>
public interface IEmailSender
{
    /// <summary>True only when a send can really work now (configured and connected) — the option is not offered otherwise.</summary>
    Task<bool> IsAvailableAsync(CancellationToken ct = default);

    /// <summary>Sends the message and returns the provider's message id once the provider confirmed it.</summary>
    Task<string> SendAsync(EmailMessage message, CancellationToken ct = default);
}

/// <summary>Used while sending is not set up: nothing is sent, and callers say so honestly.</summary>
public sealed class UnconfiguredEmailSender : IEmailSender
{
    public Task<bool> IsAvailableAsync(CancellationToken ct = default) => Task.FromResult(false);
    public Task<string> SendAsync(EmailMessage message, CancellationToken ct = default) => throw new EmailSendException("not-configured", false);
}
