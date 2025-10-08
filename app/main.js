import express from 'express';
import axios from 'axios';
import ical from 'node-ical';

const app = express();

app.get('/', async (req, res) => {
    let dateStr = req.query.date;
    if (!dateStr) {
        const today = new Date();
        dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    }

    if (!/^\d{8}$/.test(dateStr)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYYMMDD.' });
    }

    const dt = new Date(
        dateStr.slice(0, 4),
        parseInt(dateStr.slice(4, 6)) - 1,
        dateStr.slice(6, 8)
    );
    const start = new Date(dt);
    start.setHours(0, 0, 0, 0);
    const end = new Date(dt);
    end.setHours(23, 59, 59, 999);

    try {
        if (!process.env.CALENDAR_URLS) {
            return res.status(500).json({ error: 'CALENDAR_URLS environment variable not set.' });
        }

        const icalURLs = process.env.CALENDAR_URLS.split(',').map(base =>
            base + '?export&expand=1&start=' + Math.floor(start.getTime() / 1000) + '&end=' + Math.floor(end.getTime() / 1000)
        );

        const responses = await Promise.all(icalURLs.map(url =>
            axios.get(url, { headers: { 'Accept': 'text/calendar' } })
        ));

        // Parse each calendar individually
        const parsedList = responses.map(r => ical.parseICS(r.data));
        // Merge all events from both calendars
        const allEvents = parsedList.flatMap(parsed => Object.values(parsed));

        const filterCutoff = new Date(dt);
        filterCutoff.setHours(16, 0, 0, 0);

        const ev = allEvents
            .sort((a, b) => a.start - b.start)
            .filter(ev =>
            ev.start >= start &&
            ev.start <= end &&
            ev.end >= filterCutoff &&
            (ev.transparency !== 'TRANSPARENT' && ev.status !== 'FREE')
            );

        let response = '';
        if (ev.length === 0) {
            response = "Nix los; zumindest geplantes!";
        } else {
            const earliest = ev[0];
            const latest = ev[ev.length - 1];
            const startWithBuffer = new Date(earliest.start.getTime() - 45 * 60 * 1000);
            const endWithBuffer = new Date(latest.end.getTime() + 45 * 60 * 1000);
            startWithBuffer.setMinutes(0);
            endWithBuffer.setMinutes(0);
            const startStr = startWithBuffer.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
            const endStr = endWithBuffer.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
            response += `Zwischen ${startStr} und ${endStr} vermutlich Zeugs am machen.`;
            const nextDate = req.query.date
                ? new Date(
                    req.query.date.slice(0, 4),
                    parseInt(req.query.date.slice(4, 6)) - 1,
                    req.query.date.slice(6, 8)
                )
                : new Date();
            nextDate.setDate(nextDate.getDate() + 1);
            const nextDateStr = nextDate.toISOString().slice(0, 10).replace(/-/g, '');
            if (req.query.debug !== undefined) {
                response +=
                    `<hr />Debug Info:<br />\n` +
                    `Timezone: Europe/Berlin<br />\n` +
                    `Start with buffer: ${startWithBuffer.toISOString()}<br />\n` +
                    `End with buffer: ${endWithBuffer.toISOString()}<br />\n` +
                    `Earliest event name: ${earliest.summary}<br />\n` +
                    `Earliest event start: ${earliest.start.toISOString()}<br />\n` +
                    `Latest event name: ${latest.summary}<br />\n` +
                    `Latest event end: ${latest.end.toISOString()}<br />\n` +
                    `Total events considered: ${ev.length}`;
            }
        }
        if (dateStr !== new Date().toISOString().slice(0, 10).replace(/-/g, '')) {
            const dayFormatter = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: 'short', year: '2-digit' });
            const xDate = start;
            const yDate = new Date(start);
            yDate.setDate(xDate.getDate() + 1);
            const xStr = dayFormatter.format(xDate);
            const yStr = dayFormatter.format(yDate);
            response += ` (...also am ${xStr})`;
        }

        response += `<br />\n<a href="?date=${nextDateStr}">Und den Tag danach?</a>`;
        res.type('html').send(response);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch calendar.' });
    }
});

const server = app.listen(3000, () => {
    console.log('Server running on port 3000');
});
const quit = await new Promise((resolve, reject) => {
    server.on('close', resolve);
    server.on('error', reject);
});

console.log('Server closed', quit);
