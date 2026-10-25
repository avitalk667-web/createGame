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
        // no spaces, quotes or angle brackets: a link only, never markup or script
        if (group != null && group.IndexOfAny([' ', '<', '>', '"', '\'', '`', '\\']) >= 0) group = null;
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
/// Gmail API over HTTPS with OAuth 2.0 (no SMTP). Read only from the environment — never from the code or Git:
/// GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and GOOGLE_TOKEN_ENCRYPTION_KEY.
/// The redirect URI defaults to {PORTALX_SITE_URL}/api/admin/email/google/callback and must equal, character for
/// character, the one registered in Google Cloud Console.
/// </summary>
public sealed class GoogleMailOptions
{
    public const string CallbackPath = "/api/admin/email/google/callback";
    /// <summary>Sending only, plus the account's address (to check that the right mailbox was connected).</summary>
    public static readonly string[] Scopes = ["https://www.googleapis.com/auth/gmail.send", "openid", "email"];
    public const string SendScope = "https://www.googleapis.com/auth/gmail.send";

    public string? ClientId { get; init; }
    public string? ClientSecret { get; init; }
    public string? RedirectUri { get; init; }
    public string? EncryptionKey { get; init; }
    /// <summary>The only mailbox that may be connected and that mail is sent from.</summary>
    public string SenderEmail { get; init; } = SiteOptions.DefaultContactEmail;
    public string SenderName { get; init; } = "PORTAL X";

    public bool Configured => Missing().Count == 0;

    /// <summary>Names of settings that are missing or unusable (never their values).</summary>
    public IReadOnlyList<string> Missing()
    {
        var m = new List<string>();
        if (string.IsNullOrWhiteSpace(ClientId)) m.Add("GOOGLE_CLIENT_ID");
        if (string.IsNullOrWhiteSpace(ClientSecret)) m.Add("GOOGLE_CLIENT_SECRET");
        if (string.IsNullOrWhiteSpace(RedirectUri)) m.Add("GOOGLE_REDIRECT_URI");
        if (string.IsNullOrWhiteSpace(EncryptionKey) || EncryptionKey.Length < 32) m.Add("GOOGLE_TOKEN_ENCRYPTION_KEY");
        return m;
    }

    public static GoogleMailOptions FromConfig(IConfiguration c, SiteOptions site)
    {
        static string? Clean(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();
        var redirect = Clean(c["GOOGLE_REDIRECT_URI"]) ?? (site.SiteUrl != null ? site.SiteUrl + CallbackPath : null);
        // only an https callback on this site's own path (http is allowed for localhost development only)
        if (redirect != null && (!Uri.TryCreate(redirect, UriKind.Absolute, out var u)
            || !(u.Scheme == Uri.UriSchemeHttps || (u.Scheme == Uri.UriSchemeHttp && u.IsLoopback))
            || u.AbsolutePath != CallbackPath)) redirect = null;
        return new GoogleMailOptions
        {
            ClientId = Clean(c["GOOGLE_CLIENT_ID"]),
            ClientSecret = Clean(c["GOOGLE_CLIENT_SECRET"]),
            RedirectUri = redirect,
            EncryptionKey = Clean(c["GOOGLE_TOKEN_ENCRYPTION_KEY"]),
            SenderEmail = (Clean(c["PORTALX_CONTACT_EMAIL"]) ?? site.ContactEmail).ToLowerInvariant(),
        };
    }
}

/// <summary>
/// The business rule for results emails, kept apart from the sending service so it can change on its own.
/// PORTALX_RESULTS_REQUIRE_MARKETING_CONSENT (default true): results are emailed only to someone who also gave explicit
/// marketing consent in the same form. The two are still stored separately. Check this rule legally before relying on it:
/// a service email and marketing consent are different purposes.
/// </summary>
public sealed class ResultsEmailPolicy
{
    public const string ConsentRequiredMessage = "כדי לקבל את התוצאות במייל יש לאשר קבלת מיילים מ־PORTAL X. אם אינכם מעוניינים — התוצאות נשארות כאן על המסך.";

    public bool RequireMarketingConsent { get; init; } = true;

    public static ResultsEmailPolicy FromConfig(IConfiguration c) => new()
    {
        RequireMarketingConsent = !string.Equals(c["PORTALX_RESULTS_REQUIRE_MARKETING_CONSENT"]?.Trim(), "false", StringComparison.OrdinalIgnoreCase),
    };
}
