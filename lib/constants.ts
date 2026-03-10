import type { EasterEgg } from './types';

export const DEFAULT_EGGS: Omit<EasterEgg, 'id'>[] = [
  { source_song: 'Johnny B. Goode (Chuck Berry)', source_decade: '1950s', host_decade: '2000s', difficulty: 'Hard', notes: 'White Stripes-style garage rock tone next to Seven Nation Army' },
  { source_song: 'Yesterday (The Beatles)', source_decade: '1960s', host_decade: '1930s', difficulty: 'Very Hard', notes: 'Piano, brushed drums, muted trumpet — essentially a 1930s music hall song' },
  { source_song: 'Dancing Queen (ABBA)', source_decade: '1970s', host_decade: '1990s', difficulty: 'Medium', notes: 'Piano next to Bitter Sweet Symphony — ABBA harmonic language close to Britpop' },
  { source_song: 'When Doves Cry (Prince)', source_decade: '1980s', host_decade: '1960s', difficulty: 'Hard', notes: 'Psychedelic organ arrangement blending into Hendrix section' },
  { source_song: 'Smells Like Teen Spirit (Nirvana)', source_decade: '1990s', host_decade: '1970s', difficulty: 'Medium', notes: 'Heavy guitar riff could segue from or into Black Sabbath' },
  { source_song: 'Crazy in Love (Beyoncé)', source_decade: '2000s', host_decade: '1950s', difficulty: 'Hard', notes: 'Horn riff rewritten as big-band brass — sounds natural in a 1950s block' },
  { source_song: 'Get Lucky (Daft Punk)', source_decade: '2010s', host_decade: '1970s', difficulty: 'Easy', notes: 'Already a disco homage — slot next to Bee Gees with minimal arrangement changes' },
  { source_song: 'As It Was (Harry Styles)', source_decade: '2020s', host_decade: '1980s', difficulty: 'Very Hard', notes: 'After Take On Me — same falsetto register, same bright synth arpeggio world' },
];
