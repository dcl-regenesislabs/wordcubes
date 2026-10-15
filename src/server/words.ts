export type WordEntry = { question: string; answer: string; level: number }

// The question bank, one list per difficulty level (1 easy .. 7 hard). Answers are a single word of A-Z or Ñ (there is a CubeNh model).
// Easy levels use short, everyday words; harder levels use longer or less common ones. This is a starter set: a 24/7 room needs
// a much bigger bank (see docs/round-system-design.md). Add entries here, keeping each question unambiguous.
const BANK: Record<number, [string, string][]> = {
  1: [
    ['DOG', 'Barks and wags its tail'],
    ['CAT', 'Purrs and chases mice'],
    ['SUN', 'It shines in the daytime sky'],
    ['MOON', 'Lights up the night sky'],
    ['FISH', 'Swims and has fins'],
    ['BIRD', 'Has wings and feathers'],
    ['TREE', 'Tall plant with a trunk and leaves'],
    ['BOOK', 'You read it'],
    ['CAKE', 'Sweet food with candles on a birthday'],
    ['RAIN', 'Water falling from clouds'],
    ['STAR', 'Twinkles in the night sky'],
    ['BREAD', 'Baked food, a sandwich needs two slices'],
    ['APPLE', 'Red fruit, keeps the doctor away'],
    ['HOUSE', 'A place where a family lives'],
    ['WATER', 'You drink it, it is wet'],
    ['GREEN', 'Colour of grass'],
    ['SMILE', 'Happy look on your face'],
    ['PIZZA', 'Round Italian food with cheese'],
    ['AÑO', 'Spanish word for "year"']
  ],
  2: [
    ['PARIS', 'Capital of France'],
    ['TIGER', 'Striped big cat'],
    ['ROBOT', 'Machine that does tasks by itself'],
    ['OCEAN', 'Huge body of salt water'],
    ['BEACH', 'Sand next to the sea'],
    ['CLOUD', 'White shape floating in the sky'],
    ['MUSIC', 'Songs and melodies'],
    ['TRAIN', 'Runs on rails'],
    ['PIANO', 'Instrument with black and white keys'],
    ['SNAKE', 'Slithering reptile with no legs'],
    ['WINTER', 'Coldest season'],
    ['BANANA', 'Yellow curved fruit'],
    ['ORANGE', 'Citrus fruit and a colour'],
    ['GUITAR', 'Six-string instrument'],
    ['SPIDER', 'Eight legs, spins a web'],
    ['CASTLE', 'Knights lived in one'],
    ['FOREST', 'Many trees growing together'],
    ['ISLAND', 'Land surrounded by water']
  ],
  3: [
    ['PLANET', 'Earth is one of these'],
    ['ROCKET', 'Vehicle that goes to space'],
    ['DRAGON', 'Fire-breathing legend'],
    ['PIRATE', 'Sails the seas looking for treasure'],
    ['CAMERA', 'Takes photographs'],
    ['COFFEE', 'Morning drink made from beans'],
    ['JUNGLE', 'Thick tropical forest'],
    ['MUSEUM', 'Place that displays art or history'],
    ['SILVER', 'Shiny metal, Ag'],
    ['BRIDGE', 'Crosses a river'],
    ['TUNNEL', 'Underground passage'],
    ['DOLPHIN', 'Clever sea mammal that clicks and whistles'],
    ['VOLCANO', 'Mountain that erupts lava'],
    ['DIAMOND', 'Hardest natural gem'],
    ['PENGUIN', 'Flightless bird that lives in cold places'],
    ['BALLOON', 'Floats when filled with helium']
  ],
  4: [
    ['ELEPHANT', 'Largest land animal, has a trunk'],
    ['KEYBOARD', 'You type on it'],
    ['MOUNTAIN', 'Very high natural hill'],
    ['SANDWICH', 'Two slices of bread with a filling'],
    ['UMBRELLA', 'Keeps you dry in the rain'],
    ['BIRTHDAY', 'The day you were born, every year'],
    ['PAINTING', 'Artwork made with a brush'],
    ['LANTERN', 'Portable light with a handle'],
    ['TREASURE', 'Pirates bury it'],
    ['CAPTAIN', 'Leader of a ship'],
    ['HOSPITAL', 'Where doctors treat the sick'],
    ['LIBRARY', 'Place full of books you can borrow'],
    ['SCIENCE', 'Study of nature using experiments'],
    ['FESTIVAL', 'A big celebration with music and crowds']
  ],
  5: [
    ['CHOCOLATE', 'Sweet made from cocoa beans'],
    ['SUNFLOWER', 'Tall yellow flower that follows the sun'],
    ['BUTTERFLY', 'Insect with colourful wings that was a caterpillar'],
    ['ADVENTURE', 'An exciting journey'],
    ['LANGUAGE', 'English or Spanish, for example'],
    ['BLUEBERRY', 'Small round blue fruit'],
    ['EXPLORER', 'Travels to discover new places'],
    ['DINOSAUR', 'Giant reptile that lived millions of years ago'],
    ['ASTRONAUT', 'Travels to space'],
    ['HURRICANE', 'Powerful tropical storm with strong winds'],
    ['CROCODILE', 'Large reptile with strong jaws'],
    ['ALPHABET', 'A to Z'],
    ['UNIVERSE', 'Everything that exists in space']
  ],
  6: [
    ['SKYSCRAPER', 'Extremely tall building'],
    ['ARCHITECT', 'Designs buildings'],
    ['ECOSYSTEM', 'Community of living things and their environment'],
    ['LIGHTHOUSE', 'Tower that guides ships with a beam'],
    ['TELESCOPE', 'Lets you see distant stars'],
    ['SUBMARINE', 'Vessel that travels underwater'],
    ['PHOTOGRAPH', 'Picture taken with a camera'],
    ['VOCABULARY', 'All the words a person knows'],
    ['PARACHUTE', 'Slows a fall from the sky'],
    ['HEMISPHERE', 'Half of a sphere or of the Earth'],
    ['MICROSCOPE', 'Shows tiny things much bigger'],
    ['BIOGRAPHY', 'A book telling the story of a real person']
  ],
  7: [
    ['CHAMELEON', 'Lizard that changes colour'],
    ['ARCHIPELAGO', 'Group of islands'],
    ['PHILOSOPHY', 'Study of knowledge and existence'],
    ['ELECTRICITY', 'Energy that powers lamps and phones'],
    ['KALEIDOSCOPE', 'Tube of mirrors with shifting colourful patterns'],
    ['BIODIVERSITY', 'Variety of life on Earth'],
    ['RHINOCEROS', 'Large horned animal with thick skin'],
    ['HYPOTHESIS', 'An educated guess to be tested in science'],
    ['ENTREPRENEUR', 'Someone who starts a business'],
    ['CONSTELLATION', 'Pattern of stars, like Orion'],
    ['ARCHAEOLOGIST', 'Digs up ancient remains'],
    ['ANTARCTICA', 'Frozen continent at the South Pole'],
    ['TRANSPARENT', 'You can see through it']
  ],
}

export const WORDS: WordEntry[] = Object.entries(BANK).flatMap(([level, rows]) =>
  rows.map(([answer, question]) => ({ answer, question, level: Number(level) }))
)

// A random word for a difficulty level, never the same as the last round. If a level has no words, the closest level is used.
export function pickWord(level: number, exclude: string): WordEntry {
  const pool = WORDS.filter((w) => w.answer !== exclude)
  const candidates = pool.length > 0 ? pool : WORDS
  const gap = (w: WordEntry) => Math.abs(w.level - level)
  const best = Math.min(...candidates.map(gap))
  const fitting = candidates.filter((w) => gap(w) === best)
  return fitting[Math.floor(Math.random() * fitting.length)]
}
