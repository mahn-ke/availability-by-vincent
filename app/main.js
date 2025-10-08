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

        if (ev.length === 0) {
            res.type('text').send("Nix los; zumindest geplantes!");
        } else {
            const earliest = ev[0];
            const latest = ev[ev.length - 1];
            const startWithBuffer = new Date(earliest.start.getTime() - 45 * 60 * 1000);
            const endWithBuffer = new Date(latest.end.getTime() + 45 * 60 * 1000);
            startWithBuffer.setMinutes(0);
            endWithBuffer.setMinutes(0);
            const startStr = startWithBuffer.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            const endStr = endWithBuffer.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
            res.type('text').send(`Zwischen ${startStr} und ${endStr} vermutlich Zeugs am machen.`);
            // if ?debug is set, print startWithBuffer, endWithBuffer, earliest.start, latest.end
            if (req.query.debug !== undefined) {
                res.type('text').send(
                    `Zwischen ${startStr} und ${endStr} vermutlich Zeugs am machen.\n\n` +
                    `Debug Info:\n` +
                    `Start with buffer: ${startWithBuffer.toISOString()}\n` +
                    `End with buffer: ${endWithBuffer.toISOString()}\n` +
                    `Earliest event name: ${earliest.summary}\n` +
                    `Earliest event start: ${earliest.start.toISOString()}\n` +
                    `Latest event name: ${latest.summary}\n` +
                    `Latest event end: ${latest.end.toISOString()}\n` +
                    `Total events considered: ${ev.length}`
                );
            }
        }
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
