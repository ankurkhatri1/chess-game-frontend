import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import SimplePeer from 'simple-peer';
import { BrowserRouter as Router, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import './App.css';

// Socket connection with additional options for production
const socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000', {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 15,
  reconnectionDelay: 1000,
  path: '/socket.io', // Ensure correct path for production
  withCredentials: true, // Handle CORS in production
});

const isWebRTCSupported = () => {
  return !!(window.RTCPeerConnection && window.RTCIceCandidate && window.RTCSessionDescription);
};

function Game({ challengeLink, setChallengeLink, setShowLinkOptions }) {
  const queuedSignals = useRef([]);
  const [game, setGame] = useState(new Chess());
  const [position, setPosition] = useState('start');
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const peerRef = useRef(null);
  const [role, setRole] = useState(null);
  const [color, setColor] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [currentTurn, setCurrentTurn] = useState('white');
  const [error, setError] = useState('');
  const [socketConnected, setSocketConnected] = useState(false);
  const [webRTCSupported, setWebRTCSupported] = useState(true);
  const { challengeId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isWebRTCSupported()) {
      setWebRTCSupported(false);
      setError('WebRTC is not supported in this browser! Audio call will not work.');
    }
  }, []);

  useEffect(() => {
    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      setSocketConnected(true);
      setError('');
      if (challengeId) {
        console.log('Joining challenge:', challengeId);
        socket.emit('join-challenge', challengeId);
      }
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connect error:', err);
      setError(`Socket connection failed: ${err.message}. Check if backend is running at ${import.meta.env.VITE_SOCKET_URL}`);
      setSocketConnected(false);
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
      setSocketConnected(false);
      setIsConnected(false);
      setError('Disconnected from server. Please refresh the page.');
    });

    socket.on('move', ({ san, fen }) => {
      console.log('Received move:', san);
      const newGame = new Chess(fen);
      setGame(newGame);
      setPosition(fen);
    });

    socket.on('role', ({ role, color }) => {
      console.log(`Assigned role: ${role}, color: ${color}`);
      setRole(role);
      setColor(color);
    });

    socket.on('start', ({ turn, fen }) => {
      console.log('Game started, turn:', turn);
      setIsConnected(true);
      setCurrentTurn(turn);
      setPosition(fen);
      setGame(new Chess(fen));
    });

    socket.on('turn', (turn) => {
      console.log('Current turn:', turn);
      setCurrentTurn(turn);
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err);
      setError(err);
      if (err === 'Challenge not found!') {
        navigate('/');
      }
    });

    return () => {
      socket.off('connect');
      socket.off('connect_error');
      socket.off('disconnect');
      socket.off('move');
      socket.off('role');
      socket.off('start');
      socket.off('turn');
      socket.off('error');
    };
  }, [challengeId, navigate]);

  useEffect(() => {
    if (!role || !isConnected || !socketConnected || !webRTCSupported) return;

    let localStream;
    let peerInstance;

    const initPeer = async () => {
      try {
        console.log('Initializing WebRTC peer...');
        localStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: true,
        });

        if (localAudioRef.current) {
          localAudioRef.current.srcObject = localStream;
          localAudioRef.current.muted = true;
          await localAudioRef.current.play();
          console.log('Local audio stream set');
        } else {
          setError('Local audio element not found!');
          console.error('Local audio ref is null');
          return;
        }

        peerInstance = new SimplePeer({
          initiator: role === 'initiator',
          trickle: true,
          stream: localStream,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' },
              {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject',
              },
              {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject',
              },
            ],
          },
        });

        peerInstance.on('signal', (data) => {
          console.log('Sending signal:', data.type || 'candidate');
          socket.emit('signal', { data, to: role === 'initiator' ? 'receiver' : 'initiator', challengeId });
        });

        peerInstance.on('stream', (remoteStream) => {
          console.log('Received remote audio stream');
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remoteStream;
            remoteAudioRef.current.play().catch((e) => console.error('Remote audio play error:', e));
          } else {
            setError('Remote audio element not found!');
            console.error('Remote audio ref is null');
          }
        });

        peerInstance.on('connect', () => {
          console.log('WebRTC peer connected!');
        });

        peerInstance.on('error', (err) => {
          console.error('Peer error:', err);
          setError('Peer connection error: ' + err.message);
        });

        peerInstance.on('close', () => {
          console.log('Peer connection closed');
        });

        peerRef.current = peerInstance;

        socket.on('signal', ({ data, from }) => {
          console.log('Received signal from', from, ':', data.type || 'candidate');
          if (!peerRef.current || peerRef.current.destroyed) {
            queuedSignals.current.push(data);
            console.log('Signal queued:', data);
          } else {
            peerRef.current.signal(data);
          }
        });
      } catch (err) {
        console.error('Media error:', err);
        setError('Mic access denied or error: ' + err.message);
      }
    };

    initPeer();

    return () => {
      console.log('Cleaning up WebRTC...');
      if (peerInstance) {
        peerInstance.destroy();
        peerRef.current = null;
      }
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      socket.off('signal');
      queuedSignals.current = [];
    };
  }, [role, isConnected, socketConnected, webRTCSupported, challengeId]);

  useEffect(() => {
    if (peerRef.current && queuedSignals.current.length > 0) {
      console.log('Processing queued signals:', queuedSignals.current);
      queuedSignals.current.forEach(signal => {
        if (peerRef.current && !peerRef.current.destroyed) {
          peerRef.current.signal(signal);
        }
      });
      queuedSignals.current = [];
    }
  }, [peerRef.current]);

  const onDrop = (sourceSquare, targetSquare) => {
    if (color !== currentTurn) {
      alert('TERI BAARI NAHI HAI, BHAI! DUSHMAN KA WAIT KAR!');
      return false;
    }

    const newGame = new Chess(game.fen());
    const move = newGame.move({
      from: sourceSquare,
      to: targetSquare,
      promotion: 'q',
    });

    if (move === null) {
      alert('GALAT CHAL, BHAI! SOCH KE KHEL!');
      return false;
    }

    setGame(newGame);
    setPosition(newGame.fen());
    socket.emit('move', { san: move.san, challengeId });
    return true;
  };

  return (
    <div className="App">
      <h1>CHESS WITH VOICE CALL, LADAI SHURU!</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {!socketConnected && <p style={{ color: 'red' }}>Connecting to server...</p>}
      {!webRTCSupported && <p style={{ color: 'red' }}>WebRTC not supported! Audio call unavailable.</p>}
      {!isConnected && challengeLink && (
        <div style={{ marginBottom: '20px' }}>
          <p>Challenge Link: <a href={challengeLink} onClick={(e) => e.preventDefault()}>{challengeLink}</a></p>
          <button onClick={(e) => {
            e.preventDefault();
            navigator.clipboard.writeText(challengeLink).then(() => alert('Challenge link copied to clipboard!'));
          }} style={{ padding: '5px 10px', marginRight: '10px' }}>
            Copy Link
          </button>
          <button onClick={(e) => {
            e.preventDefault();
            if (navigator.share) {
              navigator.share({
                title: 'Chess Challenge',
                text: 'Join me for a chess game with voice call!',
                url: challengeLink,
              });
            } else {
              setError('Share API not supported in this browser.');
            }
          }} style={{ padding: '5px 10px' }}>
            Share Link
          </button>
          <p>Share this link with your opponent!</p>
        </div>
      )}
      <div className="game-container">
        <Chessboard
          position={position}
          onPieceDrop={onDrop}
          boardWidth={500}
          customBoardStyle={{
            borderRadius: '4px',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.5)',
          }}
        />
        <div className="audio-container">
          <div className="audio-box">
            <audio ref={localAudioRef} autoPlay playsInline />
            <div className="audio-label">TU ({color || 'Wait'})</div>
          </div>
          <div className="audio-box">
            <audio ref={remoteAudioRef} autoPlay playsInline />
            <div className="audio-label">DUSHMAN</div>
          </div>
        </div>
      </div>
      <div className="status">
        {role && `TU ${role.toUpperCase()} HAI, COLOR: ${color?.toUpperCase()}`} <br />
        {isConnected ? `CONNECTED! AB ${currentTurn.toUpperCase()} KI BAARI!` : 'DUSHMAN KA WAIT KAR...'}
      </div>
      <button onClick={() => {
        setChallengeLink('');
        setShowLinkOptions(false);
        navigate('/');
      }} style={{ marginTop: '20px' }}>
        Back to Home
      </button>
    </div>
  );
}

function Home({ setChallengeLink, setShowLinkOptions }) {
  const navigate = useNavigate();
  const [socketConnected, setSocketConnected] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      setSocketConnected(true);
      setError('');
    });

    socket.on('connect_error', (err) => {
      console.error('Socket connect error:', err);
      setError(`Socket connection failed: ${err.message}. Check if backend is running at ${import.meta.env.VITE_SOCKET_URL}`);
      setSocketConnected(false);
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err);
      setError(err);
    });

    socket.on('role', ({ role, color }) => {
      console.log(`Assigned role in Home: ${role}, color: ${color}`);
      setShowLinkOptions(true);
    });

    return () => {
      socket.off('connect');
      socket.off('connect_error');
      socket.off('error');
      socket.off('role');
    };
  }, [setShowLinkOptions]);

  const createChallenge = (e) => {
    e.preventDefault();
    if (!socketConnected) {
      setError('Cannot create challenge: Not connected to server!');
      return;
    }

    const challengeId = uuidv4();
    console.log('Creating challenge:', challengeId);
    socket.emit('create-challenge', challengeId);
    const link = `${window.location.origin}/challenge/${challengeId}`;
    setChallengeLink(link);
    setShowLinkOptions(true);
    navigate(`/challenge/${challengeId}`, { replace: true });
  };

  return (
    <div className="App">
      <h1>CHESS WITH VOICE CALL</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {!socketConnected && <p style={{ color: 'red' }}>Connecting to server...</p>}
      <button onClick={createChallenge} style={{ padding: '10px 20px', fontSize: '16px' }} disabled={!socketConnected}>
        Create Challenge
      </button>
    </div>
  );
}

function App() {
  const [challengeLink, setChallengeLink] = useState('');
  const [showLinkOptions, setShowLinkOptions] = useState(false);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home setChallengeLink={setChallengeLink} setShowLinkOptions={setShowLinkOptions} />} />
        <Route path="/challenge/:challengeId" element={<Game challengeLink={challengeLink} setChallengeLink={setChallengeLink} setShowLinkOptions={setShowLinkOptions} />} />
      </Routes>
    </Router>
  );
}

export default App;