using PortalX.Server.Mail;

namespace PortalX.Tests;

/// <summary>The daily clean-up runs at a fixed hour, never right after a start-up (which would wake the database).</summary>
public class RetentionScheduleTests
{
    private static DateTime Utc(int day, int hour, int minute = 0) => new(2026, 11, day, hour, minute, 0, DateTimeKind.Utc);

    [Fact]
    public void The_clean_up_runs_once_a_day_at_one_in_the_night_utc()
    {
        Assert.Equal(TimeSpan.FromHours(1), MailRetentionService.RunAtUtc);
        // a start-up in the evening waits for the night, it does not run now
        Assert.Equal(Utc(18, 1), MailRetentionService.NextRun(Utc(17, 20)));
        // just before the hour: today
        Assert.Equal(Utc(17, 1), MailRetentionService.NextRun(Utc(17, 0, 59)));
        // exactly at the hour (the run itself) and after it: tomorrow, so it never runs twice in a row
        Assert.Equal(Utc(18, 1), MailRetentionService.NextRun(Utc(17, 1)));
        Assert.Equal(Utc(18, 1), MailRetentionService.NextRun(Utc(17, 1, 1)));
        // month end
        Assert.Equal(new DateTime(2026, 12, 1, 1, 0, 0, DateTimeKind.Utc), MailRetentionService.NextRun(Utc(30, 12)));
    }
}
