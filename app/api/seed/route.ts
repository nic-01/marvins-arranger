import { db, migrate } from '@/db';
import { songPreferences } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { allSongs } from '@/lib/data';
import { NextResponse } from 'next/server';

const SHARED_USER_ID = 'shared';

// Titles to mark as starred
const STARRED_TITLES = [
  "Mack the Knife", "I Got Rhythm", "Minnie the Moocher", "It Don't Mean a Thing",
  "Sing Sing Sing", "In the Mood", "Over the Rainbow", "How High the Moon",
  "On the Sunny Side of the Street", "That's Amore", "Fly Me to the Moon",
  "Rock Around the Clock", "Folsom Prison Blues", "Tutti Frutti", "Blue Suede Shoes",
  "Cry Me a River", "Don't Be Cruel", "Heartbreak Hotel", "Hound Dog",
  "I Put a Spell on You", "I Walk the Line", "Long Tall Sally", "Love Me Tender",
  "My Girl", "Roll Over Beethoven", "All Shook Up", "Great Balls of Fire",
  "Jailhouse Rock", "New York New York", "You Send Me", "Johnny B. Goode",
  "Rockin' Robin", "Beyond the Sea", "My Way", "Peter Gunn",
  "There Goes My Baby", "Wonderful World",
  "Stand By Me", "Do You Love Me", "Return to Sender", "Soul Bossa Nova",
  "Blowin in the Wind", "I Want to Hold Your Hand", "Please Please Me",
  "She Loves You", "Surfin' USA", "Then He Kissed Me", "Twist and Shout",
  "A Hard Day's Night", "Can't Buy Me Love", "House of the Rising Sun",
  "I Feel Fine", "I Get Around", "Leader of the Pack", "My Girl",
  "Oh Pretty Woman", "The Times They Are a-Changin", "Viva Las Vegas",
  "You Really Got Me", "Barbara Ann", "California Girls", "Day Tripper",
  "Help", "I Feel Good", "I Got You Babe", "Like a Rolling Stone",
  "Midnight Hour", "Mr Tambourine Man", "Mustang Sally", "My Generation",
  "Satisfaction", "Stop in the Name of Love", "Ticket to Ride",
  "Unchained Melody", "Yesterday", "Good Vibrations", "Hey Joe",
  "I'm a Believer", "Paint It Black", "River Deep Mountain High",
  "These Boots Are Made for Walkin'", "When a Man Loves a Woman", "Wild Thing",
  "You Can't Hurry Love", "Ain't No Mountain High Enough", "Brown Eyed Girl",
  "Can't Take My Eyes Off You", "Dock of the Bay", "Foxy Lady",
  "Happy Together", "Midnight Train to Georgia", "Purple Haze", "Respect",
  "What a Wonderful World", "White Rabbit",
  "You Make Me Feel Like a Natural Woman",
  "A Little Less Conversation", "All Along the Watchtower", "Born to Be Wild",
  "Cross Town Traffic", "For Once in My Life", "Hey Jude",
  "I Say a Little Prayer", "Jumpin Jack Flash", "Sitting on the Dock of the Bay",
  "Son of a Preacher Man", "Sympathy for the Devil", "Time of the Season",
  "ABC", "Age of Aquarius", "Bad Moon Rising", "Come Together",
  "Fortunate Son", "Get Back", "Gimme Shelter",
  "He Ain't Heavy He's My Brother", "Here Comes the Sun", "Honky Tonk Women",
  "I Want You Back", "Let It Be", "Pinball Wizard", "Proud Mary",
  "Signed Sealed Delivered", "Sweet Caroline", "Whole Lotta Love",
  "You've Got a Friend",
  "Iron Man", "Layla", "My Sweet Lord", "Paranoid", "Signed Sealed Delivered",
  "Your Song", "American Pie", "Black Dog", "Brown Sugar",
  "Can't You Hear Me Knocking", "I Feel the Earth Move", "Imagine",
  "Riders on the Storm", "Stairway to Heaven", "Take Me Home Country Roads",
  "Tiny Dancer", "What's Going On", "Crocodile Rock", "Heart of Gold",
  "Just the Two of Us", "Lean on Me", "Papa Was a Rollin' Stone",
  "Reelin in the Years", "Smoke on the Water", "Sunshine of Your Love",
  "Superstition", "Dream On", "Free Bird", "Higher Ground",
  "I Shot the Sheriff", "I'm Still Standing", "Jolene", "Jungle Boogie",
  "La Grange", "Let's Get It On", "Live and Let Die",
  "Nutbush City Limits", "Piano Man",
  "Saturday Night's Alright for Fighting", "The Joker",
  "Sweet Home Alabama", "Bohemian Rhapsody", "Born to Run",
  "Lady Marmalade", "No Woman No Cry", "Rhiannon", "Rock and Roll All Nite",
  "Slow Ride", "That's the Way I Like It", "Thunder Road", "Walk This Way",
  "Am I Ever Gonna See Your Face Again", "Blinded by the Light",
  "Blitzkrieg Bop", "Boys Are Back in Town", "Carry On Wayward Son",
  "Dancing Queen", "Disco Inferno", "I Wish", "Isn't She Lovely",
  "Jailbreak", "More Than a Feeling", "Somebody to Love",
  "Barracuda", "Best of My Love", "Dreams", "Go Your Own Way",
  "God Save the Queen", "Hotel California", "How Deep Is Your Love",
  "I Feel Love", "Jamming", "More Than a Woman", "Mr. Blue Sky",
  "Night Fever", "One Love", "Rich Girl", "Sir Duke", "Stayin' Alive",
  "The Chain", "We Are the Champions", "We Will Rock You",
  "Wonderful Tonight", "You're the Voice",
  "Da Ya Think I'm Sexy", "Do Ya Think I'm Sexy", "Don't Stop Me Now",
  "I Will Survive", "Is This Love", "Khe Sanh", "Le Freak",
  "Love Is in the Air", "Roxanne", "September", "Sultans of Swing", "Y.M.C.A.",
  "Boys Don't Cry", "Crazy Little Thing Called Love",
  "Don't Stop Til You Get Enough", "Flame Trees", "Gimme Gimme Gimme",
  "Good Times", "Heart of Glass", "Highway to Hell",
  "I Was Made for Lovin You", "London Calling", "Message in a Bottle",
  "My Sharona", "Rappers Delight", "Rockin in the Free World",
  "Should I Stay or Should I Go", "Video Killed the Radio Star",
  "We Are Family", "What a Fool Believes",
  "9 to 5", "Another One Bites the Dust", "Any Way You Want It",
  "Back in Black", "Celebration", "Could You Be Loved",
  "Hit Me with Your Best Shot", "The Winner Takes It All",
  "You Shook Me All Night Long", "Don't Stop Believin'", "Down Under",
  "Every Little Thing She Does Is Magic", "Land Down Under",
  "Once in a Lifetime", "Under Pressure", "You Make My Dreams",
  "1999", "Africa", "Come On Eileen", "Eye of the Tiger",
  "Great Southern Land", "Man Eater", "Maneater", "Rock the Casbah", "Rosanna",
  "Blue Monday", "Cum On Feel the Noize", "Electric Avenue",
  "Every Breath You Take", "Girls Just Want to Have Fun", "Gold", "Holiday",
  "I Guess That's Why They Call It the Blues", "In a Big Country",
  "Karma Chameleon", "Let's Dance", "Owner of a Lonely Heart", "Rebel Yell",
  "Sweet Dreams", "Total Eclipse of the Heart",
  "Born in the USA", "Footloose", "Ghostbusters", "Holding Out for a Hero",
  "How Soon Is Now?", "I Just Called to Say I Love You",
  "I Want to Know What Love Is", "Jump", "Let's Go Crazy", "Like a Virgin",
  "Material Girl", "Purple Rain", "Rock You Like a Hurricane", "Run to You",
  "The Killing Moon", "Throw Your Arms Around Me",
  "Wake Me Up Before You Go-Go", "When Doves Cry", "You Spin Me Round",
  "Everybody Wants to Rule the World", "Head Over Heels",
  "Money for Nothing", "St Elmo's Fire", "Take On Me", "The Power of Love",
  "Walking on Sunshine", "Bizarre Love Triangle", "Don't Dream It's Over",
  "Hip to Be Square", "Kiss", "Papa Don't Preach", "The Final Countdown",
  "There Is a Light That Never Goes Out", "When I Think of You",
  "You Give Love a Bad Name", "Beds Are Burning", "Faith",
  "Fight for Your Right", "Heaven Is a Place on Earth",
  "I Still Haven't Found What I'm Looking For",
  "I Wanna Dance with Somebody", "Just Like Heaven",
  "Knockin on Heaven's Door", "Need You Tonight", "Never Gonna Give You Up",
  "Paradise City", "Pour Some Sugar on Me", "Push It", "Sweet Child O' Mine",
  "Talk Dirty to Me", "Welcome to the Jungle",
  "Where the Streets Have No Name", "With or Without You",
  "Never Tear Us Apart", "One", "Free Fallin", "I Won't Back Down",
  "Like a Prayer", "Love Shack", "Enjoy the Silence",
  "Groove Is in the Heart", "Ice Ice Baby", "Thunderstruck",
  "U Can't Touch This", "Vogue", "Enter Sandman", "Even Flow",
  "Give It Away", "Horses", "Losing My Religion", "November Rain",
  "Shiny Happy People", "Smells Like Teen Spirit", "Two Princes",
  "Under the Bridge", "Baby Got Back", "Come As You Are", "Creep",
  "Jump Around", "Killing in the Name", "Nothing Else Matters",
  "Rhythm Is a Dancer", "Linger", "Nuthin But a G Thang", "What Is Love",
  "What's Up", "Basket Case", "C.R.E.A.M.", "I Will Always Love You",
  "Kiss from a Rose", "Live Forever", "Loser", "Parklife",
  "Born Slippy", "California Love", "Common People", "Gangsta's Paradise",
  "Ironic", "Macarena", "Roll with It", "Waterfalls", "You Oughta Know",
  "2 Become 1", "Breathe", "Champagne Supernova", "Don't Look Back in Anger",
  "Don't Speak", "Firestarter", "Lovefool", "No Diggity",
  "Return of the Mack", "Virtual Insanity", "Wannabe",
  "Bitter Sweet Symphony", "Bittersweet Symphony", "Everlong",
  "Karma Police", "Mo Money Mo Problems", "Semi-Charmed Life", "Torn",
  "Wonderwall", "Believe", "Blue (Da Ba Dee)", "Iris", "You Get What You Give",
  "...Baby One More Time", "All Star", "All the Small Things",
  "Baby One More Time", "Better Off Alone", "Bye Bye Bye", "Californication",
  "Genie in a Bottle", "I Want It That Way", "Larger Than Life",
  "Livin' La Vida Loca", "Mambo No. 5", "Ms Jackson", "No Scrubs",
  "Right Here Right Now", "Say My Name", "Smooth", "Steal My Sunshine",
  "Three Little Birds", "What's My Age Again",
  "Beautiful Day", "Independent Women", "My Happiness",
  "Oops I Did It Again", "Rollin", "Sandstorm", "Stan", "Teenage Dirtbag",
  "The Real Slim Shady", "Yellow",
  "Can't Get You Out of My Head", "Chop Suey", "Clint Eastwood",
  "Drops of Jupiter", "Fallin", "Fat Lip", "Harder Better Faster Stronger",
  "How You Remind Me", "In the End", "Last Nite",
  "Music Sounds Better with You", "Toxicity", "Whenever Wherever",
  "By the Way", "Clocks", "Hot in Herre", "Lose Yourself", "Sk8er Boi",
  "Without Me",
  "Are You Gonna Be My Girl", "Can't Stop", "Crazy in Love", "Get Low",
  "Hey Ya!", "In da Club", "Milkshake", "Mr. Brightside", "Rock Your Body",
  "Seven Nation Army", "Stacy's Mom", "Toxic", "Where Is the Love",
  "American Idiot", "Boulevard of Broken Dreams", "Call on Me", "Float On",
  "Let's Get It Started", "Reptilia", "Since U Been Gone", "Take Me Out",
  "This Love", "Yeah!",
  "Don't Cha", "Feel Good Inc.", "Fix You", "Galvanize", "Hollaback Girl",
  "I Write Sins Not Tragedies", "Pon de Replay", "Speed of Sound",
  "Sugar We're Goin Down", "Temperature",
  "Back to Black", "Crazy", "Dani California", "Hey There Delilah",
  "Hips Don't Lie", "My Love", "Nelly Furtado", "Promiscuous",
  "Put Your Hands Up for Detroit", "Rehab", "SexyBack", "Snow (Hey Oh)",
  "Starlight", "Welcome to the Black Parade", "When You Were Young",
  "Young Folks", "Ayo Technology", "Bleeding Love", "Don't Stop the Music",
  "Grace Kelly", "Paper Planes", "Umbrella", "Untouched", "Valerie",
  "A-Punk", "Electric Feel", "Hot N Cold", "Just Dance", "Kids",
  "Poker Face", "Sex on Fire", "Single Ladies", "Use Somebody", "Viva la Vida",
  "1901", "Bad Romance", "Empire State of Mind", "I Gotta Feeling",
  "Paparazzi", "Party in the USA", "Titanium",
  "Apologize", "Baby", "California Gurls", "Firework", "Forget You",
  "Just the Way You Are", "Only Girl in the World", "Rolling in the Deep",
  "Teenage Dream", "Telephone", "TiK ToK",
  "Born This Way", "Can't Hold Us", "Give Me Everything", "Levels",
  "Love on Top", "Moves Like Jagger", "Party Rock Anthem", "Pumped Up Kicks",
  "Run the World", "Set Fire to the Rain", "Sexy and I Know It",
  "Somebody That I Used to Know", "Someone Like You", "Super Bass",
  "The Edge of Glory", "We Are Young", "We Found Love",
  "Call Me Maybe", "Clarity", "Diamonds", "Don't You Worry Child",
  "Elephant", "Feel So Close", "Gangnam Style", "Little Talks",
  "Locked Out of Heaven", "Payphone", "Radioactive", "Some Nights",
  "Starships", "Thrift Shop", "Treasure",
  "We Are Never Getting Back Together",
  "All of Me", "Am I Wrong", "Counting Stars", "Get Lucky", "Let It Go",
  "Mirrors", "Pompeii", "Riptide", "Royals", "Timber", "Wake Me Up",
  "Wrecking Ball", "Blank Space", "Shake It Off", "Shut Up and Dance",
  "Sugar", "Thinking Out Loud", "Uptown Funk",
  "Bad Blood", "Can't Feel My Face", "Hello", "Hotline Bling", "Lean On",
  "Let It Happen", "Love Yourself", "Sorry",
  "The Less I Know the Better", "What Do You Mean",
  "24K Magic", "Closer", "One Dance", "Starboy",
  "This Is What You Came For", "Work",
  "Castle on the Hill", "Congratulations", "Despacito", "Feel It Still",
  "Green Light", "Humble", "That's What I Like", "Thunder",
  "No Tears Left to Cry", "Sicko Mode",
  "7 Rings", "Bad Guy", "Blinding Lights", "Don't Start Now", "Juice",
  "Old Town Road", "Thank U Next", "Truth Hurts",
  "Dua Lipa", "Dynamite", "Heat Waves", "Levitating", "Save Your Tears",
  "The Adults Are Talking", "Watermelon Sugar",
  "Beggin'", "Easy on Me", "Good 4 U", "Montero", "My Universe", "Stay",
  "About Damn Time", "Anti-Hero", "As It Was", "Break My Soul",
  "Glimpse of Us", "Unholy",
  "Cruel Summer", "Dance the Night", "Flowers", "HOT TO GO",
  "Beautiful Things", "Birds of a Feather", "Good Luck Babe",
  "Texas Hold Em",
];

export async function GET() {
  await migrate;

  // Build a title->id lookup from the catalog
  const titleToId = new Map<string, string>();
  for (const song of allSongs) {
    titleToId.set(song.title.toLowerCase(), song.id);
  }

  // Convert titles to song IDs
  const songIds: string[] = [];
  const notFound: string[] = [];

  const seen = new Set<string>();
  for (const title of STARRED_TITLES) {
    const id = titleToId.get(title.toLowerCase());
    if (id && !seen.has(id)) {
      songIds.push(id);
      seen.add(id);
    } else if (!id) {
      // Try generating the ID directly
      const generatedId = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
      if (!seen.has(generatedId)) {
        // Verify it exists in catalog
        const exists = allSongs.some(s => s.id === generatedId);
        if (exists) {
          songIds.push(generatedId);
          seen.add(generatedId);
        } else {
          notFound.push(title);
        }
      }
    }
  }

  // Clear existing starred preferences
  const userId = SHARED_USER_ID;
  await db.delete(songPreferences).where(eq(songPreferences.userId, userId));

  // Insert all starred preferences
  if (songIds.length > 0) {
    // Insert in batches of 50 to avoid query size limits
    for (let i = 0; i < songIds.length; i += 50) {
      const batch = songIds.slice(i, i + 50);
      await db.insert(songPreferences).values(
        batch.map(songId => ({
          userId,
          songId,
          preference: 'starred',
        }))
      );
    }
  }

  return NextResponse.json({
    message: `Seeded ${songIds.length} starred songs`,
    notFound,
    total: songIds.length,
  });
}
