// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",             // <- 나중에 실제 프론트 URL로 제한해도 됨
    methods: ["GET", "POST"]
  }
});

/*
rooms[roomCode] = {
  word: "아이폰",
  wordLocked: true,
  hostId: "socket1",
  hostName: "출제자",
  guessers: [ {id:"socket2", name:"참가자1"}, ... ],

  chat: [
    { type:"q", id:1, from:"참가자1", text:"전자기기인가요?" },
    { type:"a", qid:1, from:"출제자", kind:"yes" },
    { type:"hint", from:"출제자", text:"거의 항상 들고다님" }
  ],

  lastQuestionId: 1,
  questionCount: 1,
  waitingForAnswer: 1,

  gameOver: false,
  gameResultForHost: null,      // "hostWin" | "hostLose"
  gameResultForGuesser: null,   // "guesserWin" | "guesserLose"
  finalWordShown: false
};
*/

const rooms = {};

function endGameGuesserLose(room) {
  room.gameOver = true;
  room.gameResultForHost = "hostWin";
  room.gameResultForGuesser = "guesserLose";
  room.finalWordShown = true;
}

function endGameGuesserWin(room) {
  room.gameOver = true;
  room.gameResultForHost = "hostLose";
  room.gameResultForGuesser = "guesserWin";
  room.finalWordShown = true;
}

function cleanupRoom(roomCode) {
  delete rooms[roomCode];
}

io.on("connection", (socket) => {
  // 출제자: 방 만들기
  socket.on("createRoom", ({ roomCode, nickname }) => {
    if (!roomCode) {
      socket.emit("errorMsg", "방 코드를 입력하세요.");
      return;
    }
    if (rooms[roomCode]) {
      socket.emit("errorMsg", "이미 존재하는 방 코드입니다.");
      return;
    }

    rooms[roomCode] = {
      word: null,
      wordLocked: false,
      hostId: socket.id,
      hostName: nickname || "출제자",
      guessers: [],

      chat: [],
      lastQuestionId: 0,
      questionCount: 0,
      waitingForAnswer: null,

      gameOver: false,
      gameResultForHost: null,
      gameResultForGuesser: null,
      finalWordShown: false
    };

    socket.join(roomCode);

    socket.emit("roomJoined", {
      role: "host",
      roomCode,
      word: null,
      wordLocked: false,
      questionCount: 0,
      waitingForAnswer: null,
      gameOver: false,
      gameResultForHost: null,
      gameResultForGuesser: null,
      finalWord: undefined
    });
  });

  // 참가자(정답자들): 방 참여 (여러 명 허용)
  socket.on("joinRoom", ({ roomCode, nickname }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit("errorMsg", "존재하지 않는 방 코드입니다.");
      return;
    }

    socket.join(roomCode);

    // guessers 목록에 등록
    if (!room.guessers.find((g) => g.id === socket.id)) {
      room.guessers.push({
        id: socket.id,
        name: nickname || "참가자"
      });
    }

    // 방에 들어온 사람에게 현재 상태 전달
    socket.emit("roomJoined", {
      role: socket.id === room.hostId ? "host" : "guesser",
      roomCode,
      word: socket.id === room.hostId ? room.word : undefined,
      wordLocked: room.wordLocked,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    // 방 전체에게 히스토리/상태 브로드캐스트
    io.to(roomCode).emit("chatUpdate", {
      items: room.chat,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      wordLocked: room.wordLocked,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });
  });

  // 출제자: 단어 설정 (1번만)
  socket.on("setWord", ({ roomCode, word }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.wordLocked) return;
    if (!word || !word.trim()) return;

    room.word = word.trim();
    room.wordLocked = true;

    // 모든 참가자에게 현재 상태 다시 알려서
    // 참가자 쪽에서 "아직 단어 설정 안됨" 메시지 없어지게
    io.to(roomCode).emit("roomState", {
      role: null, // 각 클라이언트가 role은 기존값 유지
      roomCode,
      word: undefined, // 출제자 외에는 안 보냄
      wordLocked: room.wordLocked,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });

    // 출제자에게만 단어 포함해서 별도로 다시 보내도 됨
    io.to(room.hostId).emit("roomState", {
      role: "host",
      roomCode,
      word: room.word,
      wordLocked: room.wordLocked,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });
  });

  // 출제자: 힌트 보내기
  socket.on("sendHint", ({ roomCode, text }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (!text || !text.trim()) return;
    if (room.gameOver) return;

    const hintMsg = {
      type: "hint",
      from: room.hostName || "출제자",
      text: text.trim()
    };
    room.chat.push(hintMsg);

    io.to(roomCode).emit("newHint", hintMsg);
  });

  // 참가자(출제자 제외): 질문
  socket.on("askQuestion", ({ roomCode, text, nickname }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (room.gameOver) return;
    if (!text || !text.trim()) return;

    // 출제자는 질문 불가
    if (socket.id === room.hostId) return;

    // 단어 아직 없으면 질문 불가
    if (!room.wordLocked || !room.word) return;

    // 아직 답 안 된 질문이 있으면 새 질문 불가
    if (room.waitingForAnswer) return;

    // 여기서는 질문 카운트 증가만 하고 끝.
    // (패배 판정은 answerQuestion에서 한다)
    room.lastQuestionId += 1;
    room.questionCount += 1;

    let askerName = nickname;
    if (!askerName) {
      const g = room.guessers.find((gg) => gg.id === socket.id);
      askerName = g ? g.name : "참가자";
    }

    const q = {
      type: "q",
      id: room.lastQuestionId,
      from: askerName,
      text: text.trim()
    };

    room.chat.push(q);
    room.waitingForAnswer = q.id;

    io.to(roomCode).emit("newQuestion", {
      ...q,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      wordLocked: room.wordLocked,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });
  });

  // 출제자: 답변
  socket.on("answerQuestion", ({ roomCode, questionId, kind }) => {
    const room = rooms[roomCode];
    if (!room) return;
    if (socket.id !== room.hostId) return;
    if (room.gameOver) return;
    if (room.waitingForAnswer !== questionId) return;

    const a = {
      type: "a",
      qid: questionId,
      from: room.hostName || "출제자",
      kind // "yes" | "no" | "idk" | "correct"
    };
    room.chat.push(a);

    // 정답 맞췄으면 -> 참가자 승리, 단어 공개, 방 삭제
    if (kind === "correct") {
      endGameGuesserWin(room);

      io.to(roomCode).emit("newAnswer", {
        ...a,
        questionCount: room.questionCount,
        waitingForAnswer: null,
        wordLocked: room.wordLocked,
        gameOver: room.gameOver,
        gameResultForHost: room.gameResultForHost,
        gameResultForGuesser: room.gameResultForGuesser,
        finalWord: room.finalWordShown ? room.word : undefined
      });

      io.to(roomCode).emit("gameOver", {
        gameResultForHost: room.gameResultForHost,
        gameResultForGuesser: room.gameResultForGuesser,
        finalWord: room.finalWordShown ? room.word : undefined
      });

      cleanupRoom(roomCode);
      return;
    }

    // 정답이 아니면: 질문은 해결됐으므로 다음 질문 가능
    room.waitingForAnswer = null;

    // 만약 지금까지 질문 수가 20 이상이면, 여기서 참가자 패배 처리
    if (room.questionCount >= 20) {
      endGameGuesserLose(room);

      // 마지막 답변 브로드캐스트 포함
      io.to(roomCode).emit("newAnswer", {
        ...a,
        questionCount: room.questionCount,
        waitingForAnswer: room.waitingForAnswer, // null
        wordLocked: room.wordLocked,
        gameOver: room.gameOver,
        gameResultForHost: room.gameResultForHost,
        gameResultForGuesser: room.gameResultForGuesser,
        finalWord: room.finalWordShown ? room.word : undefined
      });

      io.to(roomCode).emit("gameOver", {
        gameResultForHost: room.gameResultForHost,
        gameResultForGuesser: room.gameResultForGuesser,
        finalWord: room.finalWordShown ? room.word : undefined
      });

      cleanupRoom(roomCode);
      return;
    }

    // 아직 게임 안 끝난 경우: 그냥 답변만 뿌림
    io.to(roomCode).emit("newAnswer", {
      ...a,
      questionCount: room.questionCount,
      waitingForAnswer: room.waitingForAnswer,
      wordLocked: room.wordLocked,
      gameOver: room.gameOver,
      gameResultForHost: room.gameResultForHost,
      gameResultForGuesser: room.gameResultForGuesser,
      finalWord: room.finalWordShown ? room.word : undefined
    });
  });

  socket.on("disconnect", () => {
    // 여기선 굳이 방 정리 안 함
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
