namespace PortalX.Server.Mail;

/// <summary>
/// Public details of the site, read from the server's settings in one place (spec 2: one contact address).
/// PORTALX_CONTACT_EMAIL, PORTALX_SITE_URL and PORTALX_COMMUNITY_GROUP_URL may be set in the environment.
/// </summary>
public sealed class SiteOptions
{
    /// <summary>True when PORTALX_COMMUNITY_GROUP_URL was set but is not a usable https link (shown in the admin's mail status).</summary>
    public bool CommunityGroupRejected { get; init; }

    public const string DefaultContactEmail = "info.portalx@gmail.com";

    public string ContactEmail { get; init; } = DefaultContactEmail;
    /// <summary>The public address of the site for links in emails; when empty, the address of the request is used.</summary>
    public string? SiteUrl { get; init; }
    /// <summary>The updates group's invite link; only an https address is accepted. Empty = the option is not offered.</summary>
    public string? CommunityGroupUrl { get; init; }
    /// <summary>How long result-email requests and group-link requests are kept (spec 9: no unlimited retention).</summary>
    public int RetentionDays { get; init; } = 365;

    public static SiteOptions FromConfig(IConfiguration c)
    {
        static string? Clean(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();
        var group = Clean(c["PORTALX_COMMUNITY_GROUP_URL"]);
        // an invite link pasted without its scheme (e.g. "chat.whatsapp.com/...") is taken as https
        if (group != null && !group.Contains("://")) group = "https://" + group.TrimStart('/');
        if (group != null && (!Uri.TryCreate(group, UriKind.Absolute, out var u) || u.Scheme != Uri.UriSchemeHttps || !u.Host.Contains('.'))) group = null;
        var site = Clean(c["PORTALX_SITE_URL"]);
        if (site != null && !Uri.TryCreate(site, UriKind.Absolute, out _)) site = null;
        return new SiteOptions
        {
            ContactEmail = Clean(c["PORTALX_CONTACT_EMAIL"]) ?? DefaultContactEmail,
            SiteUrl = site?.TrimEnd('/'),
            CommunityGroupUrl = group,
            CommunityGroupRejected = group == null && Clean(c["PORTALX_COMMUNITY_GROUP_URL"]) != null,
            RetentionDays = int.TryParse(c["PORTALX_EMAIL_RETENTION_DAYS"], out var d) && d is > 0 and <= 3650 ? d : 365,
        };
    }
}

/// <summary>
/// SMTP connection, only from the environment or the host's secret settings — never from the code or Git:
/// SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_APP_PASSWORD, SMTP_FROM_EMAIL, SMTP_FROM_NAME, SMTP_REPLY_TO.
/// With Gmail: smtp.gmail.com, port 587, the account's address as user name and an App Password
/// (2-Step Verification must be on); the account's normal password is never used.
/// </summary>
public sealed class SmtpOptions
{
    public string? Host { get; init; }
    public int Port { get; init; } = 587;
    public string? Username { get; init; }
    public string? Password { get; init; }
    public string FromEmail { get; init; } = SiteOptions.DefaultContactEmail;
    public string FromName { get; init; } = "PORTAL X";
    public string ReplyTo { get; init; } = SiteOptions.DefaultContactEmail;
    /// <summary>STARTTLS on by default (Gmail requires it). SMTP_USE_TLS=false is only for a local test mail server.</summary>
    public bool UseTls { get; init; } = true;

    public bool Configured => !string.IsNullOrWhiteSpace(Host);

    /// <summary>What is still missing to send mail (names of settings only, never values).</summary>
    public IReadOnlyList<string> Missing()
    {
        var m = new List<string>();
        if (string.IsNullOrWhiteSpace(Host)) m.Add("SMTP_HOST");
        if (string.IsNullOrWhiteSpace(Username)) m.Add("SMTP_USERNAME");
        if (string.IsNullOrWhiteSpace(Password)) m.Add("SMTP_APP_PASSWORD");
        return m;
    }

    public static SmtpOptions FromConfig(IConfiguration c, SiteOptions site)
    {
        static string? Clean(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();
        return new SmtpOptions
        {
            Host = Clean(c["SMTP_HOST"]),
            Port = int.TryParse(c["SMTP_PORT"], out var p) && p > 0 ? p : 587,
            Username = Clean(c["SMTP_USERNAME"]),
            Password = c["SMTP_APP_PASSWORD"],
            FromEmail = Clean(c["SMTP_FROM_EMAIL"]) ?? site.ContactEmail,
            FromName = Clean(c["SMTP_FROM_NAME"]) ?? "PORTAL X",
            ReplyTo = Clean(c["SMTP_REPLY_TO"]) ?? site.ContactEmail,
            UseTls = !string.Equals(Clean(c["SMTP_USE_TLS"]), "false", StringComparison.OrdinalIgnoreCase),
        };
    }
}
