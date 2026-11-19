using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Mail;

namespace PortalX.Tests;

/// <summary>The contact window: one checked message to the site's address, the visitor as Reply-To, rate limited.</summary>
[Collection(DatabaseCollection.Name)]
public class ContactTests
{
    private readonly HubIntegrationTests.Factory _factory;
    public ContactTests(HubIntegrationTests.Factory factory) => _factory = factory;

    private (WebApplicationFactory<Program> F, FakeEmailSender Mail) WithMail(int perTenMinutes = 100000)
    {
        var mail = new FakeEmailSender();
        var f = _factory.WithWebHostBuilder(b =>
        {
            b.ConfigureAppConfiguration((_, c) => c.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["PORTALX_CONTACT_EMAIL"] = "info.portalx@gmail.com",
                ["RateLimits:ContactPer10Minutes"] = perTenMinutes.ToString(),
            }));
            b.ConfigureTestServices(s => s.AddSingleton<IEmailSender>(mail));
        });
        return (f, mail);
    }

    private static Task<HttpResponseMessage> Post(WebApplicationFactory<Program> f, object body) =>
        f.CreateClient().PostAsJsonAsync("/api/contact", body);

    [Fact]
    public async Task A_valid_message_goes_to_the_contact_address_with_the_visitor_as_reply_to()
    {
        var (f, mail) = WithMail();
        var r = await Post(f, new { name = "דוד", email = "Visitor@Example.org", message = "שאלה על המשחק\nשורה שנייה <b>" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var m = Assert.Single(mail.Sent);
        Assert.Equal("info.portalx@gmail.com", m.To);
        Assert.Equal("visitor@example.org", m.ReplyTo);
        Assert.Contains("דוד", m.Subject);
        Assert.Contains("שאלה על המשחק", m.Text);
        Assert.Contains("&lt;b&gt;", m.Html);
        Assert.DoesNotContain("<b>", m.Html);
    }

    [Theory]
    [InlineData("", "a@example.org", "הודעה ארוכה מספיק")]
    [InlineData("דוד", "not-an-email", "הודעה ארוכה מספיק")]
    [InlineData("דוד", "a@example.org\r\nBcc: x@evil.test", "הודעה ארוכה מספיק")]
    [InlineData("דוד", "a@example.org", "")]
    public async Task Bad_input_is_refused_and_nothing_is_sent(string name, string email, string message)
    {
        var (f, mail) = WithMail();
        var r = await Post(f, new { name, email, message });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(mail.Sent);
    }

    [Fact]
    public async Task A_too_long_message_is_refused()
    {
        var (f, mail) = WithMail();
        var r = await Post(f, new { name = "דוד", email = "a@example.org", message = new string('א', ContactEndpoints.MessageMax + 1) });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Empty(mail.Sent);
    }

    [Fact]
    public async Task The_hidden_field_filled_by_a_bot_sends_nothing()
    {
        var (f, mail) = WithMail();
        var r = await Post(f, new { name = "bot", email = "a@example.org", message = "buy now buy now", website = "http://spam.test" });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Empty(mail.Sent);
    }

    [Fact]
    public async Task A_failed_send_is_reported_honestly()
    {
        var (f, mail) = WithMail();
        mail.FailNext = 1;
        var r = await Post(f, new { name = "דוד", email = "a@example.org", message = "שאלה על המשחק" });
        Assert.Equal(HttpStatusCode.BadGateway, r.StatusCode);
        Assert.Contains("info.portalx@gmail.com", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Too_many_messages_from_one_address_are_rate_limited()
    {
        var (f, mail) = WithMail(perTenMinutes: 2);
        var client = f.CreateClient();
        var body = new { name = "דוד", email = "a@example.org", message = "שאלה על המשחק" };
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/contact", body)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/contact", body)).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PostAsJsonAsync("/api/contact", body)).StatusCode);
        Assert.Equal(2, mail.Sent.Count);
    }

    [Fact]
    public void Mime_sets_the_visitor_as_reply_to_and_refuses_injected_ones()
    {
        var m = ContactEndpoints.Build("info.portalx@gmail.com", "דוד", "visitor@example.org", "שלום");
        var text = Mime.Text(m, "PORTAL X", "info.portalx@gmail.com");
        Assert.Contains("Reply-To: <visitor@example.org>", text);
        Assert.Throws<EmailSendException>(() => Mime.Text(m with { ReplyTo = "a@example.org\r\nBcc: x@evil.test" }, "PORTAL X", "info.portalx@gmail.com"));
    }
}
