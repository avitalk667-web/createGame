using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PortalX.Server.Data;
using PortalX.Server.Demo;

namespace PortalX.Tests;

/// <summary>
/// "טעימה מהפורטל" (/demo): an anonymous session per browser cookie, the riddle checked only on the server, every
/// counter that matters counted once (objects, hints, the completion), and no browser able to touch another's session.
/// </summary>
[Collection(DatabaseCollection.Name)]
public class DemoTests(HubIntegrationTests.Factory factory)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private sealed record StateReply(DemoState? State);

    private HttpClient Browser() => factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = true });

    private static async Task<DemoState> StateOf(HttpResponseMessage r)
    {
        r.EnsureSuccessStatusCode();
        return (await r.Content.ReadFromJsonAsync<StateReply>(Json))!.State!;
    }

    private static async Task<DemoCodeReply> Code(HttpClient c, string code)
    {
        var r = await c.PostAsJsonAsync("/api/taste/code", new { code });
        r.EnsureSuccessStatusCode();
        return (await r.Content.ReadFromJsonAsync<DemoCodeReply>(Json))!;
    }

    private async Task<T> Db<T>(Func<PortalDbContext, Task<T>> q)
    {
        using var scope = factory.Services.CreateScope();
        return await q(scope.ServiceProvider.GetRequiredService<PortalDbContext>());
    }

    /// <summary>The session's id, found by its newest demo_started event for this test (sessions are anonymous).</summary>
    private async Task<Guid> LatestSessionAsync(DateTime since) =>
        await Db(db => db.DemoSessions.Where(s => s.CreatedAt >= since).OrderByDescending(s => s.CreatedAt).Select(s => s.Id).FirstAsync());

    [Fact]
    public async Task Starting_without_a_session_creates_one_and_a_refresh_continues_it()
    {
        var c = Browser();
        var before = await c.GetFromJsonAsync<StateReply>("/api/taste/state", Json);
        Assert.Null(before!.State);

        var since = DateTime.UtcNow.AddSeconds(-1);
        var first = await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { device = "mobile" }));
        Assert.Empty(first.Inspected);
        Assert.False(first.Completed);
        var id = await LatestSessionAsync(since);

        await StateOf(await c.PostAsJsonAsync("/api/taste/inspect", new { item = "compass" }));
        // a refresh: the same cookie continues the same session, with what was already examined
        var again = await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { device = "mobile" }));
        Assert.Equal(new[] { "compass" }, again.Inspected);
        var resumed = await c.GetFromJsonAsync<StateReply>("/api/taste/state", Json);
        Assert.Equal(new[] { "compass" }, resumed!.State!.Inspected);

        Assert.Equal(1, await Db(db => db.DemoEvents.CountAsync(e => e.SessionId == id && e.Type == "demo_started")));
        Assert.Equal("mobile", await Db(db => db.DemoSessions.Where(s => s.Id == id).Select(s => s.Device).FirstAsync()));
    }

    [Fact]
    public async Task Each_object_is_recorded_once_and_unknown_objects_are_ignored()
    {
        var c = Browser();
        var since = DateTime.UtcNow.AddSeconds(-1);
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { device = "desktop" }));
        var id = await LatestSessionAsync(since);
        foreach (var item in new[] { "letter", "letter", "clock", "nonsense", "key", "compass", "clock" })
            await StateOf(await c.PostAsJsonAsync("/api/taste/inspect", new { item }));
        var state = await c.GetFromJsonAsync<StateReply>("/api/taste/state", Json);
        Assert.Equal(new[] { "letter", "compass", "clock", "key" }, state!.State!.Inspected);
        Assert.Equal(4, await Db(db => db.DemoEvents.CountAsync(e => e.SessionId == id && e.Type == "demo_item_inspected")));
    }

    [Fact]
    public async Task At_most_two_hints_are_given_in_order()
    {
        var c = Browser();
        var since = DateTime.UtcNow.AddSeconds(-1);
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { }));
        var id = await LatestSessionAsync(since);
        var one = await StateOf(await c.PostAsync("/api/taste/hint", null));
        Assert.Equal(new[] { DemoService.HintTexts[0] }, one.Hints);
        var two = await StateOf(await c.PostAsync("/api/taste/hint", null));
        var three = await StateOf(await c.PostAsync("/api/taste/hint", null));
        Assert.Equal(DemoService.HintTexts, two.Hints);
        Assert.Equal(DemoService.HintTexts, three.Hints);
        Assert.Equal(2, await Db(db => db.DemoEvents.CountAsync(e => e.SessionId == id && e.Type == "demo_hint_requested")));
    }

    [Fact]
    public async Task Only_2741_opens_the_door_and_completion_counts_once()
    {
        var c = Browser();
        var since = DateTime.UtcNow.AddSeconds(-1);
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { }));
        var id = await LatestSessionAsync(since);

        var wrong = await Code(c, "1247");
        Assert.False(wrong.Ok);
        Assert.Equal(DemoService.WrongMessage, wrong.Message);
        var notDigits = await Code(c, "27a1");
        Assert.False(notDigits.Ok);
        Assert.Equal(1, notDigits.State.Attempts);

        var right = await Code(c, "2741");
        Assert.True(right.Ok);
        Assert.False(right.AlreadyCompleted);
        Assert.True(right.State.Completed);
        Assert.Equal(DemoService.RightMessage, right.Message);

        // pressing again, or a wrong code after the door is open, changes nothing
        var again = await Code(c, "2741");
        Assert.True(again.Ok);
        Assert.True(again.AlreadyCompleted);
        var after = await Code(c, "0000");
        Assert.True(after.Ok);
        Assert.Equal(1, await Db(db => db.DemoEvents.CountAsync(e => e.SessionId == id && e.Type == "demo_completed")));
        Assert.Equal(2, await Db(db => db.DemoEvents.CountAsync(e => e.SessionId == id && e.Type == "demo_code_attempt")));
    }

    [Fact]
    public async Task Two_tabs_pressing_the_right_code_together_complete_once()
    {
        var c = Browser();
        var since = DateTime.UtcNow.AddSeconds(-1);
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { }));
        var id = await LatestSessionAsync(since);
        var replies = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => Code(c, "2741")));
        Assert.All(replies, r => Assert.True(r.Ok));
        Assert.Equal(1, await Db(db => db.DemoEvents.CountAsync(e => e.SessionId == id && e.Type == "demo_completed")));
        Assert.Single(replies, r => !r.AlreadyCompleted);
    }

    [Fact]
    public async Task Repeated_wrong_codes_rest_the_keypad_briefly()
    {
        var c = Browser();
        await StateOf(await c.PostAsJsonAsync("/api/taste/start", new { }));
        for (var i = 0; i < DemoService.WrongBeforeCooldown; i++) Assert.False((await Code(c, "1111")).Ok);
        var resting = await Code(c, "2741");
        Assert.False(resting.Ok);
        Assert.InRange(resting.State.CooldownSeconds, 1, (int)DemoService.Cooldown.TotalSeconds);
        Assert.Contains("שניות", resting.Message);
        Assert.False(resting.State.Completed);
    }

    [Fact]
    public async Task Without_its_cookie_a_browser_cannot_touch_any_session()
    {
        var owner = Browser();
        await StateOf(await owner.PostAsJsonAsync("/api/taste/start", new { }));
        var stranger = Browser();
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsJsonAsync("/api/taste/code", new { code = "2741" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsJsonAsync("/api/taste/inspect", new { item = "key" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await stranger.PostAsync("/api/taste/hint", null)).StatusCode);
        // a made-up cookie is no better
        var forged = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        forged.DefaultRequestHeaders.Add("Cookie", $"{DemoService.Cookie}=made-up-token");
        Assert.Equal(HttpStatusCode.NotFound, (await forged.PostAsJsonAsync("/api/taste/code", new { code = "2741" })).StatusCode);
        var mine = await owner.GetFromJsonAsync<StateReply>("/api/taste/state", Json);
        Assert.False(mine!.State!.Completed);
        Assert.Empty(mine.State.Inspected);
    }

    [Fact]
    public async Task The_cookie_is_http_only_and_lasts_a_week()
    {
        var c = factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var r = await c.PostAsJsonAsync("/api/taste/start", new { });
        var cookie = r.Headers.GetValues("Set-Cookie").Single(h => h.StartsWith(DemoService.Cookie + "="));
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("max-age=604800", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", cookie, StringComparison.OrdinalIgnoreCase);
    }
}
