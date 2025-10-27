(() => {
  const { useState, useEffect, useRef } = React;
  const socket = io();

  // ---------- 말풍선 ----------
  function ChatBubble({ msg }) {
    if (msg.type === "q") {
      // 질문 (참가자 -> 왼쪽)
      return (
        React.createElement("div", { className: "text-left" },
          React.createElement("div", { className: "inline-block bubble-q px-4 py-3 mb-2 max-w-[80%]" },
            React.createElement("div", { className: "text-xs text-gray-500 mb-1" }, `${msg.from} (질문)`),
            React.createElement("div", { className: "text-base text-gray-900 break-words" }, msg.text)
          )
        )
      );
    } else if (msg.type === "a") {
      const labelMap = {
        yes: "예 ✅",
        no: "아니오 ❌",
        idk: "애매해요 🤔",
        correct: "정답 🎉"
      };
      const isCorrect = msg.kind === "correct";

      const bubbleClass = isCorrect ? "bubble-correct" : "bubble-a";
      const nameClass = isCorrect
        ? "text-xs text-gray-800 mb-1 font-semibold"
        : "text-xs text-gray-300 mb-1";

      return (
        React.createElement("div", { className: "text-right" },
          React.createElement("div", {
            className: `inline-block px-4 py-3 mb-2 max-w-[80%] ${bubbleClass}`
          },
            React.createElement("div", { className: nameClass }, `${msg.from} (답변)`),
            React.createElement("div", { className: "text-base break-words" },
              labelMap[msg.kind] || msg.kind
            )
          )
        )
      );
    } else if (msg.type === "hint") {
      return (
        React.createElement("div", { className: "text-right" },
          React.createElement("div", {
            className: "inline-block px-4 py-3 mb-2 max-w-[80%] bubble-hint"
          },
            React.createElement("div", { className: "text-xs text-white mb-1 font-semibold" },
              `${msg.from} (힌트)`
            ),
            React.createElement("div", { className: "text-base break-words" }, msg.text)
          )
        )
      );
    } else {
      return null;
    }
  }

  // ---------- 시작 화면 ----------
  function RoleSetup({ onCreate, onJoin, errorMsg }) {
    const [roomCode, setRoomCode] = useState("");
    const [nickname, setNickname] = useState("");

    return (
      React.createElement("div", { className: "w-full flex flex-col items-center" },
        errorMsg
          ? React.createElement("div", {
              className:
                "mb-4 text-sm text-red-600 bg-red-100 border border-red-300 rounded-lg px-3 py-2"
            }, errorMsg)
          : null,

        React.createElement("div", { className: "card w-full max-w-md p-6 text-gray-900" },
          React.createElement("h1", { className: "text-xl font-semibold mb-4 text-gray-900" }, "보갤스무고개"),

          React.createElement("div", { className: "mb-3" },
            React.createElement("label", { className: "block text-sm text-gray-700 mb-1" }, "방 코드"),
            React.createElement("input", {
              className:
                "w-full rounded-lg input-light px-3 py-2 outline-none",
              value: roomCode,
              onChange: (e) => setRoomCode(e.target.value),
              placeholder: "예: 1224"
            })
          ),

          React.createElement("div", { className: "mb-6" },
            React.createElement("label", { className: "block text-sm text-gray-700 mb-1" }, "닉네임"),
            React.createElement("input", {
              className:
                "w-full rounded-lg input-light px-3 py-2 outline-none",
              value: nickname,
              onChange: (e) => setNickname(e.target.value),
              placeholder: "닉네임을 입력하세요."
            })
          ),

          React.createElement("div", { className: "grid grid-cols-2 gap-3" },
            React.createElement("button", {
              className:
                "rounded-xl bg-black text-white font-semibold py-2 hover:bg-gray-800",
              onClick: () => onCreate(roomCode, nickname)
            }, "방 만들기 (출제자)"),

            React.createElement("button", {
              className:
                "rounded-xl bg-white border border-gray-300 text-gray-800 font-semibold py-2 hover:bg-gray-100",
              onClick: () => onJoin(roomCode, nickname)
            }, "입장하기 (참가자)")
          )
        )
      )
    );
  }

  // ---------- 출제자 패널 ----------
  function HostPanel({
    word,
    wordLocked,
    setWordLocal,
    roomCode,
    lastQuestion,
    onAnswer,
    onSendHint,
    questionCount,
    waitingForAnswer,
    gameOver,
    gameResultForHost,
    finalWord
  }) {
    const [pendingWord, setPendingWord] = useState(word || "");
    const [hintText, setHintText] = useState("");

    const canEditWord = !gameOver && !wordLocked;
    const canAnswer = !gameOver && waitingForAnswer !== null;

    const banner = (() => {
      if (!gameOver) return null;
      if (gameResultForHost === "hostWin") {
        return (
          React.createElement("div", {
            className: "mb-4 rounded-lg bg-green-100 text-green-800 font-bold text-center py-2 text-sm border border-green-300"
          }, `🎉 당신의 승리! 정답은 "${finalWord}"`)
        );
      } else if (gameResultForHost === "hostLose") {
        return (
          React.createElement("div", {
            className: "mb-4 rounded-lg bg-red-100 text-red-800 font-bold text-center py-2 text-sm border border-red-300"
          }, `❌ 당신의 패배... 정답은 "${finalWord}"`)
        );
      }
      return null;
    })();

    return (
      React.createElement("div", { className: "card p-4 h-full flex flex-col text-gray-900" },

        // 방 코드
        React.createElement("div", { className: "mb-4" },
          React.createElement("div", { className: "text-xs text-gray-500" }, "방 코드"),
          React.createElement("div", { className: "text-lg font-mono text-gray-900 break-all" }, roomCode)
        ),

        banner,

        // 단어 설정
        React.createElement("div", { className: "mb-6" },
          React.createElement("div", { className: "flex justify-between items-end mb-1" },
            React.createElement("div", { className: "text-xs text-gray-500" }, "정답 단어"),
            React.createElement("div", { className: "text-[10px] text-gray-400" }, `${questionCount} / 20 질문`)
          ),

          React.createElement("div", { className: "text-base font-semibold text-green-700 mb-2 break-words" },
            word ? word : "단어 입력중.."
          ),

          React.createElement("div", { className: "flex gap-2" },
            React.createElement("input", {
              className:
                "flex-1 rounded-lg input-light px-3 py-2 text-sm outline-none disabled:opacity-50",
              value: pendingWord,
              onChange: (e) => setPendingWord(e.target.value),
              placeholder: "정답 단어를 입력하세요.",
              disabled: !canEditWord
            }),
            React.createElement("button", {
              className:
                "rounded-lg bg-green-600 text-white font-semibold px-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-700",
              disabled: !canEditWord,
              onClick: () => {
                if (!pendingWord.trim()) return;
                setWordLocal(pendingWord.trim());
              }
            }, "저장")
          ),
          !canEditWord && word
            ? React.createElement("div", { className: "text-[11px] text-gray-500 mt-1" },
                "단어를 수정할 수 없습니다."
              )
            : null
        ),

        // 마지막 질문
        React.createElement("div", { className: "mb-3 text-xs text-gray-500" }, "마지막 질문"),
        React.createElement("div", {
          className:
            "flex-1 rounded-lg border border-gray-300 bg-white text-gray-800 text-sm p-3 mb-4 min-h-[4rem] break-words"
        }, lastQuestion ? lastQuestion.text : "질문 대기중"),

        // 답변 버튼들
        React.createElement("div", { className: "grid grid-cols-2 gap-3 text-sm mb-4" },
          React.createElement("button", {
            className:
              "rounded-xl bg-green-600 text-white font-semibold py-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-700",
            disabled: !canAnswer,
            onClick: () => onAnswer("yes")
          }, "예 ✅"),
          React.createElement("button", {
            className:
              "rounded-xl bg-red-600 text-white font-semibold py-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-700",
            disabled: !canAnswer,
            onClick: () => onAnswer("no")
          }, "아니오 ❌"),
          React.createElement("button", {
            className:
              "rounded-xl bg-yellow-400 text-gray-900 font-semibold py-2 col-span-1 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-yellow-300",
            disabled: !canAnswer,
            onClick: () => onAnswer("idk")
          }, "애매해요 🤔"),
          React.createElement("button", {
            className:
              "rounded-xl bg-indigo-600 text-white font-semibold py-2 col-span-1 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700",
            disabled: !canAnswer,
            onClick: () => onAnswer("correct")
          }, "정답 🎉")
        ),

        // 힌트 보내기
        React.createElement("div", { className: "text-xs text-gray-500 mb-1" }, "힌트"),
        React.createElement("div", { className: "flex gap-2" },
          React.createElement("input", {
            className:
              "flex-1 rounded-lg input-light px-3 py-2 text-sm outline-none disabled:opacity-50",
            value: hintText,
            onChange: (e) => setHintText(e.target.value),
            placeholder: "예: kno",
            disabled: gameOver
          }),
          React.createElement("button", {
            className:
              "rounded-lg bg-indigo-600 text-white font-semibold px-3 text-sm border border-transparent disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700",
            disabled: gameOver,
            onClick: () => {
              if (!hintText.trim()) return;
              onSendHint(hintText.trim());
              setHintText("");
            }
          }, "전송")
        )
      )
    );
  }

  // ---------- 참가자(정답자 역할) 패널 ----------
  function GuesserPanel({
    roomCode,
    onAsk,
    questionCount,
    waitingForAnswer,
    gameOver,
    gameResultForGuesser,
    finalWord,
    wordLocked
  }) {
    const [q, setQ] = useState("");

    // 비활성 조건:
    // 1) 게임 끝남
    // 2) 답변 대기중
    // 3) 질문 20개 다씀
    // 4) 아직 단어 미설정
    const disabled =
      gameOver ||
      waitingForAnswer !== null ||
      questionCount >= 20 ||
      !wordLocked;

    const banner = (() => {
      if (!wordLocked && !gameOver) {
        return (
          React.createElement("div", {
            className:
              "mb-4 rounded-lg bg-gray-100 text-gray-700 font-semibold text-center py-2 text-sm border border-gray-300"
          }, "출제자가 아직 단어를 설정하지 않았습니다.")
        );
      }

      if (!gameOver) return null;

      if (gameResultForGuesser === "guesserWin") {
        return (
          React.createElement("div", {
            className:
              "mb-4 rounded-lg bg-green-100 text-green-800 font-bold text-center py-2 text-sm border border-green-300"
          }, `🎉 당신의 승리! 정답은 "${finalWord}"`)
        );
      } else if (gameResultForGuesser === "guesserLose") {
        return (
          React.createElement("div", {
            className:
              "mb-4 rounded-lg bg-red-100 text-red-800 font-bold text-center py-2 text-sm border border-red-300"
          }, `❌ 당신의 패배... 정답은 "${finalWord}"`)
        );
      }
      return null;
    })();

    return (
      React.createElement("div", { className: "card p-4 h-full flex flex-col text-gray-900" },

        // 방 코드
        React.createElement("div", { className: "mb-4" },
          React.createElement("div", { className: "text-xs text-gray-500" }, "방 코드"),
          React.createElement("div", { className: "text-lg font-mono text-gray-900 break-all" }, roomCode)
        ),

        banner,

        // 질문 입력
        React.createElement("div", { className: "text-xs text-gray-500 mb-1 flex justify-between" },
          React.createElement("span", null, "질문 보내기"),
          React.createElement("span", { className: "text-[10px] text-gray-400" },
            `${questionCount} / 20 질문`
          )
        ),

        React.createElement("div", { className: "flex gap-2 mb-4" },
          React.createElement("input", {
            className:
              "flex-1 rounded-lg input-light px-3 py-2 text-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed",
            value: q,
            onChange: (e) => setQ(e.target.value),
            placeholder: disabled
              ? (waitingForAnswer !== null
                  ? "출제자 답변 대기중..."
                  : (!wordLocked
                      ? "단어 설정 중..."
                      : "지금은 질문 불가"))
              : "예: 사람인가요?",
            disabled
          }),
          React.createElement("button", {
            className:
              "rounded-lg bg-black text-white font-semibold px-3 text-sm border border-transparent disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed hover:bg-gray-800",
            disabled,
            onClick: () => {
              if (!q.trim() || disabled) return;
              onAsk(q.trim());
              setQ("");
            }
          }, "전송")
        ),

        React.createElement("div", { className: "text-[11px] text-gray-500" },
          waitingForAnswer !== null
            ? ""
            : ""
        )
      )
    );
  }

  // ---------- 메인 App ----------
  function App() {
    const [role, setRole] = useState(null); // "host" | "guesser"
    const [roomCode, setRoomCode] = useState(null);

    const [word, setWord] = useState(null);
    const [wordLocked, setWordLocked] = useState(false);

    const [chat, setChat] = useState([]);
    const [lastQ, setLastQ] = useState(null);
    const [lastQid, setLastQid] = useState(null);

    const [questionCount, setQuestionCount] = useState(0);
    const [waitingForAnswer, setWaitingForAnswer] = useState(null);

    const [gameOver, setGameOver] = useState(false);
    const [gameResultForHost, setGameResultForHost] = useState(null);
    const [gameResultForGuesser, setGameResultForGuesser] = useState(null);
    const [finalWord, setFinalWord] = useState(undefined);

    const [errorMsg, setErrorMsg] = useState(null);
    const [nickname, setNickname] = useState(null);

    const chatRef = useRef(null);
    useEffect(() => {
      if (chatRef.current) {
        chatRef.current.scrollTop = chatRef.current.scrollHeight;
      }
    }, [chat]);

    useEffect(() => {
      socket.on("roomJoined", (data) => {
        if (data.role) setRole(data.role);
        if (data.roomCode) setRoomCode(data.roomCode);
        if (data.word !== undefined) setWord(data.word);
        if (data.wordLocked !== undefined) setWordLocked(data.wordLocked);

        if (data.questionCount !== undefined) setQuestionCount(data.questionCount);
        if (data.waitingForAnswer !== undefined) setWaitingForAnswer(data.waitingForAnswer);

        if (data.gameOver !== undefined) setGameOver(data.gameOver);
        if (data.gameResultForHost !== undefined) setGameResultForHost(data.gameResultForHost);
        if (data.gameResultForGuesser !== undefined) setGameResultForGuesser(data.gameResultForGuesser);
        if (data.finalWord !== undefined) setFinalWord(data.finalWord);
      });

      socket.on("chatUpdate", (payload) => {
        const {
          items,
          questionCount,
          waitingForAnswer,
          wordLocked,
          gameOver,
          gameResultForHost,
          gameResultForGuesser,
          finalWord
        } = payload;

        setChat(items || []);
        if (questionCount !== undefined) setQuestionCount(questionCount);
        if (waitingForAnswer !== undefined) setWaitingForAnswer(waitingForAnswer);
        if (wordLocked !== undefined) setWordLocked(wordLocked);
        if (gameOver !== undefined) setGameOver(gameOver);
        if (gameResultForHost !== undefined) setGameResultForHost(gameResultForHost);
        if (gameResultForGuesser !== undefined) setGameResultForGuesser(gameResultForGuesser);
        if (finalWord !== undefined) setFinalWord(finalWord);

        const reversed = [...(items || [])].reverse();
        const q = reversed.find((m) => m.type === "q");
        if (q) {
          setLastQ(q);
          setLastQid(q.id);
        }
      });

      socket.on("newQuestion", (q) => {
        setChat((prev) => [...prev, q]);
        setLastQ(q);
        setLastQid(q.id);

        if (q.questionCount !== undefined) setQuestionCount(q.questionCount);
        if (q.waitingForAnswer !== undefined) setWaitingForAnswer(q.waitingForAnswer);
        if (q.wordLocked !== undefined) setWordLocked(q.wordLocked);
        if (q.gameOver !== undefined) setGameOver(q.gameOver);
        if (q.gameResultForHost !== undefined) setGameResultForHost(q.gameResultForHost);
        if (q.gameResultForGuesser !== undefined) setGameResultForGuesser(q.gameResultForGuesser);
        if (q.finalWord !== undefined) setFinalWord(q.finalWord);
      });

      socket.on("newAnswer", (a) => {
        setChat((prev) => [...prev, a]);

        if (a.questionCount !== undefined) setQuestionCount(a.questionCount);
        if (a.waitingForAnswer !== undefined) setWaitingForAnswer(a.waitingForAnswer);
        if (a.wordLocked !== undefined) setWordLocked(a.wordLocked);
        if (a.gameOver !== undefined) setGameOver(a.gameOver);
        if (a.gameResultForHost !== undefined) setGameResultForHost(a.gameResultForHost);
        if (a.gameResultForGuesser !== undefined) setGameResultForGuesser(a.gameResultForGuesser);
        if (a.finalWord !== undefined) setFinalWord(a.finalWord);
      });

      socket.on("newHint", (hintMsg) => {
        setChat((prev) => [...prev, hintMsg]);
      });

      socket.on("roomState", (st) => {
        if (st.role) setRole(st.role);
        if (st.roomCode) setRoomCode(st.roomCode);
        if (st.word !== undefined) setWord(st.word);
        if (st.wordLocked !== undefined) setWordLocked(st.wordLocked);

        if (st.questionCount !== undefined) setQuestionCount(st.questionCount);
        if (st.waitingForAnswer !== undefined) setWaitingForAnswer(st.waitingForAnswer);

        if (st.gameOver !== undefined) setGameOver(st.gameOver);
        if (st.gameResultForHost !== undefined) setGameResultForHost(st.gameResultForHost);
        if (st.gameResultForGuesser !== undefined) setGameResultForGuesser(st.gameResultForGuesser);
        if (st.finalWord !== undefined) setFinalWord(st.finalWord);
      });

      socket.on("gameOver", ({ gameResultForHost, gameResultForGuesser, finalWord }) => {
        if (gameResultForHost !== undefined) setGameResultForHost(gameResultForHost);
        if (gameResultForGuesser !== undefined) setGameResultForGuesser(gameResultForGuesser);
        if (finalWord !== undefined) setFinalWord(finalWord);
        setGameOver(true);
      });

      socket.on("errorMsg", (msg) => {
        setErrorMsg(msg);
      });

      return () => {
        socket.off("roomJoined");
        socket.off("chatUpdate");
        socket.off("newQuestion");
        socket.off("newAnswer");
        socket.off("newHint");
        socket.off("roomState");
        socket.off("gameOver");
        socket.off("errorMsg");
      };
    }, []);

    // 액션
    function handleCreate(roomCodeInput, nick) {
      setNickname(nick || "출제자");
      socket.emit("createRoom", { roomCode: roomCodeInput, nickname: nick });
    }

    function handleJoin(roomCodeInput, nick) {
      setNickname(nick || "참가자");
      socket.emit("joinRoom", { roomCode: roomCodeInput, nickname: nick });
    }

    function setWordLocal(newWord) {
      if (!roomCode) return;
      setWord(newWord);
      setWordLocked(true);
      socket.emit("setWord", { roomCode, word: newWord });
    }

    function askQuestion(text) {
      if (!roomCode) return;
      socket.emit("askQuestion", { roomCode, text, nickname });
    }

    function answerQuestion(kind) {
      if (!roomCode || lastQid == null) return;
      socket.emit("answerQuestion", { roomCode, questionId: lastQid, kind });
    }

    function sendHint(text) {
      if (!roomCode) return;
      socket.emit("sendHint", { roomCode, text });
    }

    // 역할 아직 없으면 대기 화면
    if (!role) {
      return (
        React.createElement(RoleSetup, {
          onCreate: handleCreate,
          onJoin: handleJoin,
          errorMsg
        })
      );
    }

    // 레이아웃: 모바일=세로, 데스크톱=좌(채팅) 우(패널)
    return (
      React.createElement("div", { className: "w-full grid md:grid-cols-3 gap-4" },

        // 채팅 영역
        React.createElement("div", {
          className:
            "md:col-span-2 card p-4 flex flex-col h-[70vh] overflow-hidden order-1 md:order-none text-gray-900"
        },
          React.createElement("div", {
            className:
              "text-gray-900 font-semibold text-lg mb-2 flex justify-between"
          },
            React.createElement("span", null, ""),
            React.createElement("span", {
              className: "badge-role"
            }, role === "host" ? "출제자" : "참가자")
          ),

          React.createElement("div", {
            ref: chatRef,
            className:
              "flex-1 overflow-y-auto pr-2 space-y-2 text-sm scrollbar-thin"
          },
            chat.map((msg, i) => React.createElement(ChatBubble, { key: i, msg }))
          )
        ),

        // 우측 패널
        React.createElement("div", {
          className: "md:col-span-1 order-2 md:order-none"
        },
          role === "host"
            ? React.createElement(HostPanel, {
                word,
                wordLocked,
                setWordLocal,
                roomCode,
                lastQuestion: lastQ,
                onAnswer: answerQuestion,
                onSendHint: sendHint,
                questionCount,
                waitingForAnswer,
                gameOver,
                gameResultForHost,
                finalWord
              })
            : React.createElement(GuesserPanel, {
                roomCode,
                onAsk: askQuestion,
                questionCount,
                waitingForAnswer,
                gameOver,
                gameResultForGuesser,
                finalWord,
                wordLocked
              })
        )
      )
    );
  }

  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(React.createElement(App));
})();
