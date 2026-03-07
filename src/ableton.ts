/**
 * Ableton Live Set (.als) Export
 *
 * Generates a gzip-compressed XML file that Ableton Live can open.
 * Creates:
 * - Tempo automation matching the medley's BPM changes
 * - Locators (markers) for each song in arrangement view
 * - An audio track per song as a placeholder for dragging in audio
 *
 * Supports Live 11 and Live 12 format versions.
 */

import type { MedleySong } from './types';

export type AbletonVersion = '11' | '12';

const VERSION_INFO: Record<AbletonVersion, { minor: string; creator: string }> = {
  '11': { minor: '11.0.12', creator: 'Ableton Live 11.3.21' },
  '12': { minor: '12.1.1',  creator: 'Ableton Live 12.1.1' },
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert seconds to Ableton beat-time given a BPM */
function secondsToBeats(seconds: number, bpm: number): number {
  return (seconds * bpm) / 60;
}

function buildLocators(songs: MedleySong[]): string {
  let beatPos = 0;
  const locators: string[] = [];

  songs.forEach((song, i) => {
    locators.push(`
              <Locator Id="${i}">
                <Time Value="${beatPos.toFixed(6)}" />
                <Name Value="${escapeXml(song.title)} - ${escapeXml(song.artist)}" />
                <Annotation Value="" />
                <IsSongStart Value="false" />
              </Locator>`);
    beatPos += secondsToBeats(song.snippet_duration, song.bpm);
  });

  return locators.join('');
}

function buildTempoAutomation(songs: MedleySong[]): string {
  let beatPos = 0;
  const points: string[] = [];

  songs.forEach((song, i) => {
    // Set tempo at the start of each song
    points.push(`
                    <AutomationEvent Id="${i * 2}" Time="${beatPos.toFixed(6)}" Value="${song.bpm}" CurveControl1X="0.5" CurveControl1Y="0.5" CurveControl2X="0.5" CurveControl2Y="0.5" />`);
    beatPos += secondsToBeats(song.snippet_duration, song.bpm);
  });

  return points.join('');
}

function buildTracks(songs: MedleySong[]): string {
  let beatPos = 0;
  const tracks: string[] = [];

  songs.forEach((song, i) => {
    const trackId = 100 + i;
    const clipId = 200 + i;
    const songBeats = secondsToBeats(song.snippet_duration, song.bpm);
    const clipEnd = beatPos + songBeats;
    const name = `${song.year} ${song.title}`;
    const color = getTrackColor(song, i);

    tracks.push(`
          <AudioTrack Id="${trackId}">
            <DeviceChain>
              <AutomationLanes />
              <MainSequencer>
                <ClipSlotList />
                <ArrangerAutomation>
                  <Events />
                </ArrangerAutomation>
                <Sample>
                  <ArrangerAutomation>
                    <Events>
                      <AudioClip Id="${clipId}" Time="${beatPos.toFixed(6)}" CurrentStart="${beatPos.toFixed(6)}" CurrentEnd="${clipEnd.toFixed(6)}">
                        <Name Value="${escapeXml(name)}" />
                        <Color Value="${color}" />
                        <Annotation Value="${escapeXml(song.arrangement_notes || `${song.section || 'chorus'} · ${song.bar_count || 16} bars · ${song.key}`)}" />
                        <IsWarped Value="true" />
                        <Loop>
                          <LoopStart Value="0" />
                          <LoopEnd Value="${songBeats.toFixed(6)}" />
                          <StartRelative Value="0" />
                          <LoopOn Value="false" />
                        </Loop>
                      </AudioClip>
                    </Events>
                  </ArrangerAutomation>
                </Sample>
              </MainSequencer>
              <Mixer>
                <Volume>
                  <Manual Value="0.794328" />
                </Volume>
                <Pan>
                  <Manual Value="0" />
                </Pan>
              </Mixer>
            </DeviceChain>
            <Name Value="${escapeXml(name)}" />
            <Color Value="${color}" />
          </AudioTrack>`);

    beatPos += songBeats;
  });

  return tracks.join('');
}

function getTrackColor(_song: MedleySong, index: number): number {
  // Ableton color palette indices (0-69), cycle through distinct colors
  const colors = [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69];
  return colors[index % colors.length];
}

function buildAbletonXml(songs: MedleySong[], version: AbletonVersion): string {
  const info = VERSION_INFO[version];
  const initialBpm = songs.length > 0 ? songs[0].bpm : 120;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="${info.minor}" SchemaChangeCount="3" Creator="${info.creator}" Revision="">
  <LiveSet>
    <NextPointeeId Value="${1000 + songs.length * 10}" />
    <OverwriteProtectionNumber Value="2819" />

    <MasterTrack>
      <DeviceChain>
        <AutomationLanes />
        <Mixer>
          <Tempo>
            <Manual Value="${initialBpm}" />
            <MidiControllerRange>
              <Min Value="60" />
              <Max Value="200" />
            </MidiControllerRange>
            <AutomationTarget Id="1" />
            <ModulationTarget Id="2" />
          </Tempo>
          <TimeSignature>
            <TimeSignatures>
              <RemoteableTimeSignature Id="0">
                <Numerator Value="4" />
                <Denominator Value="4" />
                <Time Value="0" />
              </RemoteableTimeSignature>
            </TimeSignatures>
          </TimeSignature>
          <Volume>
            <Manual Value="1" />
          </Volume>
        </Mixer>
      </DeviceChain>
      <AutomationEnvelopes>
        <Envelopes>
          <AutomationEnvelope Id="0">
            <EnvelopeTarget>
              <PointeeId Value="1" />
            </EnvelopeTarget>
            <Automation>
              <Events>${buildTempoAutomation(songs)}
              </Events>
            </Automation>
          </AutomationEnvelope>
        </Envelopes>
      </AutomationEnvelopes>
    </MasterTrack>

    <Tracks>${buildTracks(songs)}
    </Tracks>

    <Locators>
      <Locators>${buildLocators(songs)}
      </Locators>
    </Locators>

    <Transport>
      <PhaseNudgeTempo>
        <Manual Value="${initialBpm}" />
      </PhaseNudgeTempo>
    </Transport>

  </LiveSet>
</Ableton>`;
}

/** Gzip compress a string and return a Blob */
async function gzipCompress(text: string): Promise<Blob> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);

  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  return new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
}

export async function exportAbletonAls(songs: MedleySong[], version: AbletonVersion): Promise<void> {
  const xml = buildAbletonXml(songs, version);
  const blob = await gzipCompress(xml);

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hundred-years-medley-live${version}.als`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
