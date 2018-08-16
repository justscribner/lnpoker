const db = require("../db");

const { performance } = require("perf_hooks");

// @params NA
// @return table if already created, else false
// @desc find the first table in the DB. This is temporary until we add ability for multiple tables
const findTable = async () => {
  const { rows } = await db.query("SELECT * FROM lnpoker.tables limit 1");

  if (rows.length < 1) {
    return false;
  }

  return rows[0];
};

// @params NA
// @return table object without players array
// @desc create a new table using default params instead of destructuring table arguments, start new round
const createNewTable = async userID => {
  const res = await db.query(
    "INSERT INTO lnpoker.tables DEFAULT VALUES returning *"
  );

  // auto join newly created table
  await joinTable(res.rows[0].id, userID);

  return res.rows[0];
};

// @params tableID and userID
// @return null
// @desc add user's id to user_table and distribute his cards from deck
const joinTable = async (tableID, userID) => {
  const errors = {};
  // append user id to table | auto join the table you create
  await db.query(
    "INSERT INTO lnpoker.user_table(player_id, table_id) VALUES ($1, $2)",
    [userID, tableID]
  );

  //If there is no current game and we have enough players, start a new game. Set status to started
  const tableRow = await db.query(
    "SELECT status, minplayers from lnpoker.tables where id = $1",
    [tableID]
  );
  const playersRows = await db.query(
    "SELECT count(id) as numplayers from lnpoker.user_table where table_id = $1",
    [tableID]
  );

  const minPlayers =
    tableRow.rows.length > 0 ? tableRow.rows[0].minplayers : null;
  const numPlayers =
    playersRows.rows.length > 0 ? parseInt(playersRows.rows[0].numplayers) : 0;
  // return error if we don't find table
  if (minPlayers === null) {
    errors.table = "No table found";
    throw errors;
  }
  // check if we have minimum number of players
  if (numPlayers < minPlayers) {
    errors.players = "Not enough players";
    throw errors;
  }
  // start new round if status is 'waiting'
  if (tableRow.rows[0].status === "waiting") {
    // start a new round
    newRound(tableID);

    // set table status to started
    await db.query(
      "UPDATE lnpoker.tables SET status = 'started' where id = $1",
      [tableID]
    );
  }
};

// @params tableID
// @return array
// @desc return array of users found on table
const getPlayersAtTable = async tableID => {
  const players = await db.query(
    "SELECT username, dealer, chips, folded, allin, talked FROM lnpoker.users INNER join lnpoker.user_table on lnpoker.users.id = lnpoker.user_table.player_id WHERE lnpoker.user_table.table_id = $1",
    [tableID]
  );

  if (players.rows.length > 0) {
    return players.rows;
  }
  // else return empty array
  return [];
};

// @params tableID and userID
// @return bool
// @desc return true if user is found on table, else false
const isPlayerOnTable = async (userID, tableID) => {
  const result = await db.query(
    "SELECT username FROM lnpoker.users INNER join lnpoker.user_table on lnpoker.users.id = lnpoker.user_table.player_id WHERE lnpoker.user_table.player_id = $1 and lnpoker.user_table.table_id = $2",
    [userID, tableID]
  );

  if (result.rows.length > 0) {
    return true;
  }

  return false;
};

// @desc - join existing table
// @params - cb is a callback function that takes errors as it's first param, and table state as second. userID takes user id from requesting user
// returns errors or table data
const joinTableIfItExists = async (cb, userID) => {
  let table;
  try {
    table = await findTable();
    // create new table if none found
    if (!table) {
      table = await createNewTable(userID);

      table.players = await getPlayersAtTable(table.id);

      return cb(null, table);
    }

    // return table if player is already on table
    if (await isPlayerOnTable(userID, table.id)) {
      table.players = await getPlayersAtTable(table.id);
      return cb(null, table);
    }

    // set player object to requesting user's id if above are false
    // add the user to the table
    await joinTable(table.id, userID);

    table.players = await getPlayersAtTable(table.id);
  } catch (error) {
    return cb(error);
  }
  return cb(null, table);
};

// @desc - join existing table
// @params - cb is a callback function that takes errors as it's first param, and table state as second. userID takes user id from requesting user
// returns errors or table data
const exitTable = async userID => {
  await db.query(
    "DELETE FROM lnpoker.user_table WHERE lnpoker.user_table.player_id = $1",
    [userID]
  );
};

// @desc - trigger this to start a new round
// @params - tableID
// returns null
const newRound = async tableID => {
  // console.log("newRound on table, ", tableID);
  // deck will contain comma separated string of deck array
  const deck = "{" + fillDeck().join() + "}";

  await db.query(
    "UPDATE lnpoker.tables SET deck = $1 WHERE id=$2 RETURNING *",
    [deck, tableID]
  );

  // // Add players in waiting list
  // var removeIndex = 0;
  // for (var i in this.playersToAdd) {
  //   if (removeIndex < this.playersToRemove.length) {
  //     var index = this.playersToRemove[removeIndex];
  //     this.players[index] = this.playersToAdd[i];
  //     removeIndex += 1;
  //   } else {
  //     this.players.push(this.playersToAdd[i]);
  //   }
  // }
  // this.playersToRemove = [];
  // this.playersToAdd = [];
  // this.gameWinners = [];
  // this.gameLosers = [];

  // var i, smallBlind, bigBlind;
  // //Deal 2 cards to each player
  // for (i = 0; i < this.players.length; i += 1) {
  //   this.players[i].cards.push(this.game.deck.pop());
  //   this.players[i].cards.push(this.game.deck.pop());
  //   this.game.bets[i] = 0;
  //   this.game.roundBets[i] = 0;
  // }
  // //Identify Small and Big Blind player indexes
  // smallBlind = this.dealer + 1;
  // if (smallBlind >= this.players.length) {
  //   smallBlind = 0;
  // }
  // bigBlind = this.dealer + 2;
  // if (bigBlind >= this.players.length) {
  //   bigBlind -= this.players.length;
  // }
  // //Force Blind Bets
  // this.players[smallBlind].chips -= this.smallBlind;
  // this.players[bigBlind].chips -= this.bigBlind;
  // this.game.bets[smallBlind] = this.smallBlind;
  // this.game.bets[bigBlind] = this.bigBlind;

  // // get currentPlayer
  // this.currentPlayer = this.dealer + 3;
  // if (this.currentPlayer >= this.players.length) {
  //   this.currentPlayer -= this.players.length;
  // }

  // this.eventEmitter.emit("newRound");
};

// @desc - trigger this after a round is complete
// @params - tableID
// returns null
const initNewRound = tableID => {
  // cycle dealer clockwise
  let i;
  this.dealer += 1;
  if (this.dealer >= this.players.length) {
    this.dealer = 0;
  }
  // set pot to 0,
  this.game.pot = 0;
  this.game.roundName = "Deal"; //Start the first round
  this.game.betName = "bet"; //bet,raise,re-raise,cap
  this.game.bets.splice(0, this.game.bets.length);
  this.game.deck.splice(0, this.game.deck.length);
  this.game.board.splice(0, this.game.board.length);
  for (i = 0; i < this.players.length; i += 1) {
    this.players[i].folded = false;
    this.players[i].talked = false;
    this.players[i].allIn = false;
    this.players[i].cards.splice(0, this.players[i].cards.length);
  }
  fillDeck(this.game.deck);
  this.NewRound();
};

// function to create and shuffle a deck of 52 cards
const fillDeck = () => {
  const deck = [];
  deck.push("AS");
  deck.push("KS");
  deck.push("QS");
  deck.push("JS");
  deck.push("TS");
  deck.push("9S");
  deck.push("8S");
  deck.push("7S");
  deck.push("6S");
  deck.push("5S");
  deck.push("4S");
  deck.push("3S");
  deck.push("2S");
  deck.push("AH");
  deck.push("KH");
  deck.push("QH");
  deck.push("JH");
  deck.push("TH");
  deck.push("9H");
  deck.push("8H");
  deck.push("7H");
  deck.push("6H");
  deck.push("5H");
  deck.push("4H");
  deck.push("3H");
  deck.push("2H");
  deck.push("AD");
  deck.push("KD");
  deck.push("QD");
  deck.push("JD");
  deck.push("TD");
  deck.push("9D");
  deck.push("8D");
  deck.push("7D");
  deck.push("6D");
  deck.push("5D");
  deck.push("4D");
  deck.push("3D");
  deck.push("2D");
  deck.push("AC");
  deck.push("KC");
  deck.push("QC");
  deck.push("JC");
  deck.push("TC");
  deck.push("9C");
  deck.push("8C");
  deck.push("7C");
  deck.push("6C");
  deck.push("5C");
  deck.push("4C");
  deck.push("3C");
  deck.push("2C");

  //Shuffle the deck array with Fisher-Yates
  var i, j, tempi, tempj;
  for (i = 0; i < deck.length; i += 1) {
    j = Math.floor(Math.random() * (i + 1));
    tempi = deck[i];
    tempj = deck[j];
    deck[i] = tempj;
    deck[j] = tempi;
  }

  return deck;
};

module.exports = { joinTableIfItExists, exitTable };

// START GAME, TABLE STATE: Table {
//   smallBlind: 50,
//   bigBlind: 100,
//   minPlayers: 4,
//   maxPlayers: 10,
//   players:
//    [ Player {
//        playerName: 'bob',
//        chips: 1000,
//        folded: false,
//        allIn: false,
//        talked: false,
//        table: [Circular],
//        cards: [Array] },
//      Player {
//        playerName: 'jane',
//        chips: 950,
//        folded: false,
//        allIn: false,
//        talked: false,
//        table: [Circular],
//        cards: [Array] },
//      Player {
//        playerName: 'dylan',
//        chips: 900,
//        folded: false,
//        allIn: false,
//        talked: false,
//        table: [Circular],
//        cards: [Array] },
//      Player {
//        playerName: 'john',
//        chips: 1000,
//        folded: false,
//        allIn: false,
//        talked: false,
//        table: [Circular],
//        cards: [Array] } ],
//   dealer: 0,
//   minBuyIn: 100,
//   maxBuyIn: 1000,
//   playersToRemove: [],
//   playersToAdd: [],
//   eventEmitter:
//    EventEmitter {
//      domain: null,
//      _events: {},
//      _eventsCount: 0,
//      _maxListeners: undefined },
//   turnBet: {},
//   gameWinners: [],
//   gameLosers: [],
//   game:
//    Game {
//      smallBlind: 50,
//      bigBlind: 100,
//      pot: 0,
//      roundName: 'Deal',
//      betName: 'bet',
//      bets: [ 0, 50, 100, 0 ],
//      roundBets: [ 0, 0, 0, 0 ],
//      deck:
//       [ 'KS',
//         'KH',
//         'QD',
//         '9S',
//         '2S',
//         '5D',
//         '4D',
//         'QS',
//         '2H',
//         '9C',
//         'AH',
//         'QC',
//         '5S',
//         '6S',
//         'TH',
//         'TC',
//         '5H',
//         '3C',
//         '3H',
//         '6C',
//         'TD',
//         'JC',
//         '4S',
//         '8H',
//         '4H',
//         '9D',
//         '4C',
//         'KD',
//         '3D',
//         '5C',
//         '2C',
//         'AC',
//         '9H',
//         '7S',
//         '8D',
//         'TS',
//         'JH',
//         'KC',
//         '3S',
//         '8S',
//         '6H',
//         'AD',
//         'JD',
//         'AS' ],
//      board: [] },
//   currentPlayer: 3 }
