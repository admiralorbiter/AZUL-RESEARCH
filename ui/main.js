// Main entry point for the React app
// Using global React and ReactDOM from CDN

const { createRoot } = ReactDOM;

// Import utility functions (these will be defined inline)
const API_BASE = '/api/v1';
let sessionId = null;

// API functions
async function initializeSession() {
    try {
        const response = await fetch(`${API_BASE}/auth/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        sessionId = data.session_id;
        return data;
    } catch (error) {
        console.error('Failed to initialize session:', error);
        throw error;
    }
}

async function analyzePosition(fenString) {
    try {
        const response = await fetch(`${API_BASE}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fen_string: fenString })
        });
        return await response.json();
    } catch (error) {
        console.error('Failed to analyze position:', error);
        throw error;
    }
}

async function getGameState(fenString = 'initial') {
    try {
        const response = await fetch(`${API_BASE}/game_state?fen_string=${fenString}`);
        const data = await response.json();
        // Return the nested game_state property
        return data.game_state || data;
    } catch (error) {
        console.error('Failed to get game state:', error);
        throw error;
    }
}

async function getHint(fenString) {
    try {
        const response = await fetch(`${API_BASE}/hint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fen_string: fenString })
        });
        return await response.json();
    } catch (error) {
        console.error('Failed to get hint:', error);
        throw error;
    }
}

// Generate heatmap data from analysis
function generateHeatmapData(analysisData) {
    if (!analysisData || !analysisData.variations) return null;
    
    const heatmap = {};
    const bestScore = analysisData.variations[0]?.score || 0;
    
    analysisData.variations.forEach(variation => {
        const scoreDelta = variation.score - bestScore;
        const normalizedScore = Math.max(-1, Math.min(1, scoreDelta / 10)); // Normalize to -1 to 1
        
        // Extract move information for heatmap positioning
        if (variation.move_data) {
            const key = `${variation.move_data.source_id}_${variation.move_data.tile_type}`;
            heatmap[key] = {
                score: variation.score,
                delta: scoreDelta,
                normalized: normalizedScore,
                color: getHeatmapColor(normalizedScore)
            };
        }
    });
    
    return heatmap;
}

// Get heatmap color based on score delta
function getHeatmapColor(normalizedScore) {
    // Red for bad moves (negative), green for good moves (positive)
    const intensity = Math.abs(normalizedScore);
    if (normalizedScore < 0) {
        return `rgba(239, 68, 68, ${intensity})`; // Red with alpha
    } else {
        return `rgba(34, 197, 94, ${intensity})`; // Green with alpha
    }
}

// Helper functions
const TILE_COLORS = {
    'R': '#ef4444', 'Y': '#eab308', 'B': '#3b82f6', 
    'W': '#f8fafc', 'K': '#8b5cf6'
};

function getTileColor(tile) {
    return TILE_COLORS[tile] || '#6b7280';
}

function formatMoveDescription(move) {
    if (!move) return 'No move available';
    return `Move: ${move.source_id} → ${move.pattern_line_dest} (${move.tile_type})`;
}

function formatSelectedElement(element) {
    if (!element) return 'No element selected';
    return `${element.type}: ${JSON.stringify(element.data)}`;
}

function getMenuOptions(elementType, elementData) {
    const options = [];
    switch (elementType) {
        case 'factory':
            options.push('Clear Factory', 'Add Tiles', 'Remove Tiles');
            break;
        case 'pattern-line':
            options.push('Clear Line', 'Add Tile', 'Remove Tile');
            break;
        case 'wall':
            options.push('Place Tile', 'Remove Tile', 'Clear Wall');
            break;
        case 'floor':
            options.push('Add Penalty', 'Remove Penalty', 'Clear Floor');
            break;
    }
    return options;
}

// Tile Component
function Tile({ color, onClick, className = "", draggable = false, onDragStart, onDragEnd, dataAttributes = {}, isSelected = false }) {
    const tileRef = React.useRef(null);
    
    React.useEffect(() => {
        const tile = tileRef.current;
        if (!tile) return;
        
        const handleDragStart = (e) => {
            if (onDragStart) onDragStart(e);
            e.dataTransfer.effectAllowed = 'move';
        };
        
        const handleDragEnd = (e) => {
            if (onDragEnd) onDragEnd(e);
        };
        
        if (draggable) {
            tile.addEventListener('dragstart', handleDragStart);
            tile.addEventListener('dragend', handleDragEnd);
        }
        
        return () => {
            if (draggable) {
                tile.removeEventListener('dragstart', handleDragStart);
                tile.removeEventListener('dragend', handleDragEnd);
            }
        };
    }, [draggable, onDragStart, onDragEnd]);
    
    const selectedClass = isSelected ? 'ring-2 ring-blue-500 ring-offset-2' : '';
    
    return React.createElement('div', {
        ref: tileRef,
        className: `tile ${className} ${selectedClass}`,
        style: { backgroundColor: getTileColor(color) },
        onClick: onClick,
        draggable: draggable,
        ...dataAttributes
    });
}

// Factory Component
function Factory({ tiles, onTileClick, heatmap = null, factoryIndex, selectedTile = null, onTileSelection = null, editMode = false, onElementSelect = null, selectedElement = null, heatmapEnabled = false, heatmapData = null }) {
    const factoryRef = React.useRef(null);
    
    React.useEffect(() => {
        const factory = factoryRef.current;
        if (!factory) return;
        
        const handleDragOver = (e) => {
            e.preventDefault();
            e.currentTarget.classList.add('drag-over');
        };
        
        const handleDragLeave = (e) => {
            e.currentTarget.classList.remove('drag-over');
        };
        
        const handleDrop = (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('drag-over');
        };
        
        factory.addEventListener('dragover', handleDragOver);
        factory.addEventListener('dragleave', handleDragLeave);
        factory.addEventListener('drop', handleDrop);
        
        return () => {
            factory.removeEventListener('dragover', handleDragOver);
            factory.removeEventListener('dragleave', handleDragLeave);
            factory.removeEventListener('drop', handleDrop);
        };
    }, []);
    
    const handleFactoryClick = (e) => {
        if (editMode && onElementSelect) {
            // In edit mode, handle edit actions
            if (window.handleEditClick) {
                window.handleEditClick('factory', { factoryIndex, tiles });
            } else {
                onElementSelect({
                    type: 'factory',
                    data: { factoryIndex, tiles },
                    timestamp: Date.now()
                });
            }
        }
    };
    
    const handleFactoryRightClick = (e) => {
        e.preventDefault();
        if (editMode && window.showContextMenu) {
            window.showContextMenu(e, 'factory', { factoryIndex, tiles });
        }
    };
    
    const isSelected = selectedElement && selectedElement.type === 'factory' && selectedElement.data.factoryIndex === factoryIndex;
    const isEditSelected = editMode && isSelected;
    
    // Get heatmap overlay style for this factory
    const getHeatmapOverlay = (tileType) => {
        if (!heatmapEnabled || !heatmapData) return {};
        
        const tileTypeMapping = { 'B': 0, 'Y': 1, 'R': 2, 'K': 3, 'W': 4 };
        const key = `${factoryIndex}_${tileTypeMapping[tileType] || 0}`;
        const heatmapInfo = heatmapData[key];
        
        if (heatmapInfo) {
            return {
                position: 'relative',
                '::after': {
                    content: '""',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: heatmapInfo.color,
                    borderRadius: '4px',
                    pointerEvents: 'none'
                }
            };
        }
        return {};
    };
    
    return React.createElement('div', {
        ref: factoryRef,
        className: `factory ${isEditSelected ? 'selected' : ''} ${heatmapEnabled ? 'heatmap-enabled' : ''}`,
        onClick: handleFactoryClick,
        onContextMenu: handleFactoryRightClick,
        style: { position: 'relative' }
    },
        tiles.map((tile, index) => {
            const heatmapKey = `${factoryIndex}_${tile === 'B' ? 0 : tile === 'Y' ? 1 : tile === 'R' ? 2 : tile === 'K' ? 3 : 4}`;
            const heatmapInfo = heatmapEnabled && heatmapData ? heatmapData[heatmapKey] : null;
            
            return React.createElement('div', {
                key: index,
                style: { position: 'relative' }
            },
                React.createElement(Tile, {
                    color: tile,
                    onClick: () => onTileClick ? onTileClick(factoryIndex, index, tile) : null,
                    draggable: true,
                    onDragStart: (e) => {
                        e.dataTransfer.setData('application/json', JSON.stringify({
                            sourceType: 'factory',
                            sourceId: factoryIndex,
                            tileIndex: index,
                            tile: tile
                        }));
                    },
                    isSelected: selectedTile && selectedTile.sourceId === factoryIndex && selectedTile.tileIndex === index
                }),
                // Heatmap overlay
                heatmapInfo && React.createElement('div', {
                    className: 'heatmap-overlay',
                    style: {
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: heatmapInfo.color,
                        borderRadius: '4px',
                        pointerEvents: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '10px',
                        color: 'white',
                        fontWeight: 'bold',
                        textShadow: '1px 1px 1px rgba(0,0,0,0.8)'
                    }
                }, heatmapInfo.delta > 0 ? `+${heatmapInfo.delta.toFixed(1)}` : heatmapInfo.delta.toFixed(1))
            );
        })
    );
}

// Move execution functions
async function executeMove(fenString, move, agentId = 0) {
    try {
        console.log('Sending move to server:', { fen_string: fenString, move: move, agent_id: agentId });
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        const response = await fetch(`${API_BASE}/execute_move`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-Session-ID': sessionId 
            },
            body: JSON.stringify({
                fen_string: fenString,
                move: move,
                agent_id: agentId
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Server error response:', response.status, errorText);
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }
        
        const result = await response.json();
        console.log('Server response:', result);
        return result;
    } catch (error) {
        console.error('Failed to execute move:', error);
        
        // Handle different types of errors
        if (error.name === 'AbortError') {
            throw new Error('Request timed out. Server may be overloaded.');
        }
        
        if (error.message.includes('Failed to fetch') || error.message.includes('ERR_CONNECTION_RESET')) {
            throw new Error('Server connection lost. Please refresh the page and try again.');
        }
        
        throw error;
    }
}

// PatternLine Component
function PatternLine({ tiles, rowIndex, maxTiles, onTileClick, onDrop, selectedTile = null, onDestinationClick = null, editMode = false, onElementSelect = null, playerIndex = null, selectedElement = null }) {
    const patternLineRef = React.useRef(null);
    
    React.useEffect(() => {
        const patternLine = patternLineRef.current;
        if (!patternLine) return;
        
        const handleDragOver = (e) => {
            e.preventDefault();
            e.currentTarget.classList.add('drag-over');
        };
        
        const handleDragLeave = (e) => {
            e.currentTarget.classList.remove('drag-over');
        };
        
        const handleDrop = (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('drag-over');
            if (onDrop) onDrop(e, rowIndex);
        };
        
        patternLine.addEventListener('dragover', handleDragOver);
        patternLine.addEventListener('dragleave', handleDragLeave);
        patternLine.addEventListener('drop', handleDrop);
        
        return () => {
            patternLine.removeEventListener('dragover', handleDragOver);
            patternLine.removeEventListener('dragleave', handleDragLeave);
            patternLine.removeEventListener('drop', handleDrop);
        };
    }, [onDrop, rowIndex]);
    
    const handlePatternLineClick = (e) => {
        if (editMode && onElementSelect) {
            // In edit mode, handle edit actions
            if (window.handleEditClick) {
                window.handleEditClick('pattern-line', { playerIndex, rowIndex, tiles, maxTiles });
            } else {
                onElementSelect({
                    type: 'pattern-line',
                    data: { playerIndex, rowIndex, tiles, maxTiles },
                    timestamp: Date.now()
                });
            }
        }
    };
    
    const handlePatternLineRightClick = (e) => {
        e.preventDefault();
        if (editMode && window.showContextMenu) {
            window.showContextMenu(e, 'pattern-line', { playerIndex, rowIndex, tiles });
        }
    };
    
    const isSelected = selectedElement && selectedElement.type === 'pattern-line' && selectedElement.data.rowIndex === rowIndex;
    const isEditSelected = editMode && isSelected;
    
    return React.createElement('div', {
        ref: patternLineRef,
        className: `pattern-line ${isEditSelected ? 'selected' : ''}`,
        onClick: handlePatternLineClick,
        onContextMenu: handlePatternLineRightClick
    },
        tiles.map((tile, index) => 
            React.createElement(Tile, {
                key: index,
                color: tile,
                onClick: () => onTileClick ? onTileClick(rowIndex, index, tile) : null
            })
        ),
        Array.from({ length: maxTiles - tiles.length }, (_, index) => 
            React.createElement('div', {
                key: `empty-${index}`,
                className: 'empty-slot',
                onClick: () => onDestinationClick ? onDestinationClick(rowIndex, tiles.length + index) : null
            })
        )
    );
}

// Wall Component
function Wall({ wall, onWallClick, onDrop, selectedTile = null, onDestinationClick = null, editMode = false, onElementSelect = null, playerIndex = null, selectedElement = null }) {
    const wallRef = React.useRef(null);
    
    React.useEffect(() => {
        const wall = wallRef.current;
        if (!wall) return;
        
        const handleDragOver = (e) => {
            e.preventDefault();
            e.currentTarget.classList.add('drag-over');
        };
        
        const handleDragLeave = (e) => {
            e.currentTarget.classList.remove('drag-over');
        };
        
        const handleDrop = (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('drag-over');
            if (onDrop) onDrop(e);
        };
        
        wall.addEventListener('dragover', handleDragOver);
        wall.addEventListener('dragleave', handleDragLeave);
        wall.addEventListener('drop', handleDrop);
        
        return () => {
            wall.removeEventListener('dragover', handleDragOver);
            wall.removeEventListener('dragleave', handleDragLeave);
            wall.removeEventListener('drop', handleDrop);
        };
    }, [onDrop]);
    
    return React.createElement('div', {
        ref: wallRef,
        className: 'wall'
    },
        wall.map((row, rowIndex) => 
            React.createElement('div', {
                key: rowIndex,
                className: 'wall-row'
            },
                row.map((cell, colIndex) => 
                    React.createElement('div', {
                        key: colIndex,
                        className: `wall-cell ${cell ? 'filled' : 'empty'}`,
                        onClick: () => {
                            if (editMode && window.handleEditClick) {
                                window.handleEditClick('wall-cell', { playerIndex, rowIndex, colIndex, cell });
                            } else if (onWallClick) {
                                onWallClick(rowIndex, colIndex, cell);
                            }
                        },
                        onContextMenu: (e) => {
                            e.preventDefault();
                            if (editMode && window.showContextMenu) {
                                window.showContextMenu(e, 'wall', { playerIndex, rowIndex, colIndex, cell });
                            }
                        }
                    },
                        cell ? React.createElement(Tile, { color: cell }) : null
                    )
                )
            )
        )
    );
}

// PlayerBoard Component
function PlayerBoard({ player, playerIndex, onPatternLineClick, onWallClick, onPatternLineDrop, onWallDrop, selectedTile = null, onDestinationClick = null, isActive = false, onPlayerSwitch = null, canInteract = true, gameMode = 'sandbox', editMode = false, onElementSelect = null, selectedElement = null }) {
    const borderClass = isActive ? 'border-4 border-blue-500 bg-blue-50' : 'border-2 border-gray-300 bg-gray-50';
    const headerClass = isActive ? 'text-blue-700 font-bold' : 'text-gray-700';
    
    return React.createElement('div', {
        className: `player-board ${borderClass} p-4 rounded-lg mb-4`
    },
        React.createElement('div', {
            className: `flex justify-between items-center mb-4 ${headerClass}`
        },
            React.createElement('h3', null, `Player ${playerIndex + 1}`),
            React.createElement('div', {
                className: 'flex space-x-2'
            },
                React.createElement('button', {
                    className: 'px-3 py-1 bg-blue-500 text-white rounded text-sm',
                    onClick: () => onPlayerSwitch ? onPlayerSwitch(playerIndex) : null
                }, 'Switch'),
                React.createElement('span', {
                    className: 'text-sm'
                }, `Score: ${player.score || 0}`)
            )
        ),
        React.createElement('div', {
            className: 'grid grid-cols-2 gap-4'
        },
            React.createElement('div', {
                className: 'pattern-lines'
            },
                player.pattern_lines.map((line, index) => 
                    React.createElement(PatternLine, {
                        key: index,
                        tiles: line,
                        rowIndex: index,
                        maxTiles: index + 1,
                        onTileClick: onPatternLineClick,
                        onDrop: onPatternLineDrop,
                        selectedTile: selectedTile,
                        onDestinationClick: onDestinationClick,
                        editMode: editMode,
                        onElementSelect: onElementSelect,
                        playerIndex: playerIndex,
                        selectedElement: selectedElement
                    })
                )
            ),
            React.createElement('div', {
                className: 'wall-section'
            },
                React.createElement(Wall, {
                    wall: player.wall,
                    onWallClick: onWallClick,
                    onDrop: onWallDrop,
                    selectedTile: selectedTile,
                    onDestinationClick: onDestinationClick,
                    editMode: editMode,
                    onElementSelect: onElementSelect,
                    playerIndex: playerIndex,
                    selectedElement: selectedElement
                })
            )
        ),
        React.createElement('div', {
            className: 'floor-line mt-4'
        },
            React.createElement('h4', {
                className: 'text-sm font-medium mb-2'
            }, 'Floor Line'),
            React.createElement('div', {
                className: 'flex flex-wrap gap-1'
            },
                (player.floor_line || []).map((tile, index) => 
                    React.createElement(Tile, {
                        key: index,
                        color: tile,
                        className: 'w-6 h-6'
                    })
                ),
                Array.from({ length: 7 - (player.floor_line || []).length }, (_, index) => 
                    React.createElement('div', {
                        key: `empty-floor-${index}`,
                        className: 'w-6 h-6 border border-gray-300 rounded',
                        onContextMenu: (e) => {
                            e.preventDefault();
                            if (editMode && window.showContextMenu) {
                                window.showContextMenu(e, 'floor', { playerIndex, floorIndex: index });
                            }
                        }
                    })
                )
            )
        )
    );
}

// StatusMessage Component
function StatusMessage({ type, message }) {
    const typeClasses = {
        success: 'status-success',
        error: 'status-error',
        warning: 'status-warning'
    };
    
    return React.createElement('div', {
        className: `text-center p-3 rounded-lg ${typeClasses[type] || 'text-gray-600'}`
    }, message);
}

// MoveOption Component
function MoveOption({ move, score, visits, onClick, isSelected }) {
    return React.createElement('div', {
        className: `move-option ${isSelected ? 'selected' : ''}`,
        onClick: onClick
    },
        React.createElement('div', {
            className: 'flex justify-between items-center'
        },
            React.createElement('span', {
                className: 'font-medium'
            }, move),
            React.createElement('span', {
                className: 'text-sm'
            }, score?.toFixed(2) || 'N/A')
        ),
        visits && React.createElement('div', {
            className: 'text-xs text-gray-500'
        }, `Visits: ${visits}`)
    );
}

// ContextMenu Component
function ContextMenu({ visible, x, y, options, onAction, onClose }) {
    if (!visible) return null;
    
    return React.createElement('div', {
        className: 'context-menu',
        style: { 
            left: x, 
            top: y,
            position: 'fixed'
        },
        onClick: (e) => e.stopPropagation()
    },
        options.map((option, index) => 
            React.createElement('div', {
                key: index,
                className: 'context-menu-item',
                onClick: () => onAction(option)
            }, option)
        )
    );
}

// Main App Component
function App() {
    // State declarations
    const [sessionStatus, setSessionStatus] = React.useState('connecting');
    const [statusMessage, setStatusMessage] = React.useState('Initializing...');
    const [loading, setLoading] = React.useState(false);
    const [gameState, setGameState] = React.useState(null);
    const [selectedTile, setSelectedTile] = React.useState(null);
    const [editMode, setEditMode] = React.useState(false);
    const [selectedElement, setSelectedElement] = React.useState(null);
    const [editTarget, setEditTarget] = React.useState(null); // For tracking what we're editing
    const [editAction, setEditAction] = React.useState(null); // 'add', 'remove', 'move'
    const [contextMenu, setContextMenu] = React.useState({ visible: false, x: 0, y: 0, options: [] });
    const [variations, setVariations] = React.useState([]);
    const [moveAnnotations, setMoveAnnotations] = React.useState({});
    const [moveHistory, setMoveHistory] = React.useState([]);
    const [currentPlayer, setCurrentPlayer] = React.useState(0);
    const [engineThinking, setEngineThinking] = React.useState(false);
    const [heatmapEnabled, setHeatmapEnabled] = React.useState(false);
    const [heatmapData, setHeatmapData] = React.useState(null);
    
    // Initialize session
    React.useEffect(() => {
        initializeSession()
            .then(() => {
                setSessionStatus('connected');
                setStatusMessage('Connected to server');
                return getGameState();
            })
            .then(data => {
                console.log('Initial game state:', data);
                setGameState(data);
                setStatusMessage('Game loaded');
            })
            .catch(error => {
                setSessionStatus('error');
                setStatusMessage(`Connection failed: ${error.message}`);
            });
    }, []);
    
    // Refresh game state periodically to stay in sync
    React.useEffect(() => {
        const interval = setInterval(() => {
            if (sessionStatus === 'connected' && !loading) {
                getGameState().then(data => {
                    setGameState(data);
                }).catch(error => {
                    console.error('Failed to refresh game state:', error);
                });
            }
        }, 5000); // Refresh every 5 seconds
        
        return () => clearInterval(interval);
    }, [sessionStatus, loading]);
    
    // Clear selection function
    const clearSelection = React.useCallback(() => {
        setSelectedTile(null);
        setSelectedElement(null);
        setStatusMessage('Selection cleared');
    }, []);
    
    // Handle element selection
    const handleElementSelect = React.useCallback((element) => {
        setSelectedElement(element);
        setStatusMessage(formatSelectedElement(element));
    }, []);

    // Edit mode functions
    const handleEditModeToggle = React.useCallback(() => {
        const newEditMode = !editMode;
        setEditMode(newEditMode);
        
        if (newEditMode) {
            setStatusMessage('Edit mode enabled. Click on elements to select them.');
        } else {
            setStatusMessage('Edit mode disabled.');
            setSelectedElement(null);
            setEditTarget(null);
            setEditAction(null);
        }
    }, [editMode]);

    const handleEditAction = React.useCallback((action, target) => {
        setEditAction(action);
        setEditTarget(target);
        
        switch (action) {
            case 'add':
                setStatusMessage(`Click where you want to add a ${target} tile`);
                break;
            case 'remove':
                setStatusMessage(`Click on a ${target} tile to remove it`);
                break;
            case 'move':
                setStatusMessage(`Click on a tile to move it`);
                break;
            default:
                setStatusMessage('Select an edit action');
        }
    }, []);

    const handleEditClick = React.useCallback((elementType, elementData) => {
        if (!editMode) return;

        switch (editAction) {
            case 'add':
                // Add tile to the clicked location
                console.log('Adding tile to:', elementType, elementData);
                setStatusMessage(`Added tile to ${elementType}`);
                break;
            case 'remove':
                // Remove tile from the clicked location
                console.log('Removing tile from:', elementType, elementData);
                setStatusMessage(`Removed tile from ${elementType}`);
                break;
            case 'move':
                // Move tile to the clicked location
                console.log('Moving tile to:', elementType, elementData);
                setStatusMessage(`Moved tile to ${elementType}`);
                break;
            default:
                // Just select the element
                setSelectedElement({ type: elementType, data: elementData });
                setStatusMessage(`Selected ${elementType}`);
        }
    }, [editMode, editAction]);
    
    // Handle move execution
    const handleMoveExecution = React.useCallback(async (move) => {
        if (!gameState) return;
        
        setLoading(true);
        setStatusMessage('Executing move...');
        
        try {
            const result = await executeMove(gameState.fen_string || 'initial', move, currentPlayer);
            
            if (result.success) {
                // Update game state with new FEN
                const newGameState = await getGameState(result.new_fen);
                setGameState(newGameState);
                
                // Add to move history
                setMoveHistory(prev => [...prev, {
                    move: move,
                    result: result,
                    timestamp: Date.now(),
                    player: currentPlayer
                }]);
                
                setStatusMessage(`Move executed: ${result.move_executed}`);
                
                // Clear selection
                setSelectedTile(null);
                
                // Handle engine response
                if (result.engine_response && !result.game_over) {
                    setEngineThinking(true);
                    setStatusMessage(`Engine thinking... Best move: ${result.engine_response.move}`);
                    
                    // Auto-advance to next player or apply engine move
                    setTimeout(() => {
                        setEngineThinking(false);
                        setCurrentPlayer(prev => (prev + 1) % (gameState.players?.length || 2));
                    }, 1000);
                }
                
                if (result.game_over) {
                    setStatusMessage(`Game Over! Final scores: ${result.scores.join(', ')}`);
                }
            } else {
                console.error('Move failed:', result);
                setStatusMessage(`Move failed: ${result.error || 'Unknown error'}`);
                
                // Reset game state to ensure consistency
                getGameState().then(freshState => {
                    setGameState(freshState);
                    console.log('Game state refreshed after failed move');
                });
            }
        } catch (error) {
            setStatusMessage(`Error executing move: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }, [gameState, currentPlayer]);
    
    // Helper function to convert tile color to type
    const getTileType = React.useCallback((tileColor) => {
        const mapping = { 'B': 0, 'Y': 1, 'R': 2, 'K': 3, 'W': 4 };
        return mapping[tileColor] !== undefined ? mapping[tileColor] : 0;
    }, []);
    
    // Handle pattern line drop
    const handlePatternLineDrop = React.useCallback((e, rowIndex) => {
        e.preventDefault();
        
        try {
            const dragData = JSON.parse(e.dataTransfer.getData('application/json'));
            console.log('Drop data received:', dragData);
            
            if (dragData.sourceType === 'factory') {
                // Validate that the factory still has this tile
                const factory = gameState?.factories?.[dragData.sourceId];
                if (!factory) {
                    setStatusMessage(`Factory ${dragData.sourceId} not found`);
                    return;
                }
                
                // Check if the tile exists in the factory
                const tileExists = factory.includes(dragData.tile);
                if (!tileExists) {
                    setStatusMessage(`Tile ${dragData.tile} not found in factory ${dragData.sourceId}`);
                    console.log('Available tiles in factory:', factory);
                    return;
                }
                
                const tileType = getTileType(dragData.tile);
                
                // Count how many tiles of this color are in the factory
                const tilesOfColor = factory.filter(tile => tile === dragData.tile).length;
                
                // In Azul, you take ALL tiles of the chosen color
                // Check current pattern line state
                const activePlayer = gameState?.players?.[currentPlayer];
                const currentPatternLine = activePlayer?.pattern_lines?.[rowIndex] || [];
                const maxPatternLineCapacity = rowIndex + 1; // Pattern line 0 holds 1, line 1 holds 2, etc.
                const currentTilesInLine = currentPatternLine.length;
                const availableSpace = maxPatternLineCapacity - currentTilesInLine;
                
                // Determine how many go to pattern line vs floor line
                const tilesToPattern = Math.min(tilesOfColor, availableSpace);
                const tilesToFloor = tilesOfColor - tilesToPattern;
                
                // Validate the move makes sense
                if (availableSpace <= 0) {
                    setStatusMessage(`Pattern line ${rowIndex} is already full!`);
                    return;
                }
                
                if (tilesOfColor === 0) {
                    setStatusMessage(`No ${dragData.tile} tiles found in factory ${dragData.sourceId}`);
                    return;
                }
                
                // Check if pattern line already has different colored tiles
                if (currentTilesInLine > 0) {
                    const existingTileColor = currentPatternLine[0];
                    if (existingTileColor !== dragData.tile) {
                        setStatusMessage(`Pattern line ${rowIndex} already contains ${existingTileColor} tiles!`);
                        return;
                    }
                }
                
                const move = {
                    source_id: dragData.sourceId,
                    tile_type: tileType,
                    pattern_line_dest: rowIndex,
                    num_to_pattern_line: tilesToPattern,
                    num_to_floor_line: tilesToFloor
                };
                
                console.log('=== MOVE DEBUG ===');
                console.log(`Factory ${dragData.sourceId} contents:`, factory);
                console.log(`Taking ${tilesOfColor} ${dragData.tile} tiles (type ${tileType})`);
                console.log(`Pattern line ${rowIndex}: ${currentTilesInLine}/${maxPatternLineCapacity} tiles`);
                console.log(`Available space: ${availableSpace}`);
                console.log(`Distribution: ${tilesToPattern} to pattern line, ${tilesToFloor} to floor`);
                console.log('Move object:', move);
                console.log('==================');
                
                setStatusMessage(`Taking ${tilesOfColor} ${dragData.tile} tiles: ${tilesToPattern} to pattern line, ${tilesToFloor} to floor`);
                handleMoveExecution(move);
            }
        } catch (error) {
            console.error('Drop error:', error);
            setStatusMessage(`Invalid drop data: ${error.message}`);
        }
    }, [handleMoveExecution, gameState, getTileType]);
    
    // Position export/import functions
    const exportPosition = React.useCallback(() => {
        if (!gameState) return;
        
        const exportData = {
            fen: gameState.fen_string || 'initial',
            moveHistory: moveHistory,
            currentPlayer: currentPlayer,
            timestamp: Date.now(),
            description: `Azul position - ${moveHistory.length} moves`,
            metadata: {
                scores: gameState.players?.map(p => p.score) || [],
                gameMode: 'sandbox'
            }
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: 'application/json'
        });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `azul_position_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        setStatusMessage('Position exported successfully');
    }, [gameState, moveHistory, currentPlayer]);
    
    const importPosition = React.useCallback((file) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                
                // Load the game state from FEN
                getGameState(data.fen).then(newGameState => {
                    setGameState(newGameState);
                    
                    // Restore move history if available
                    if (data.moveHistory) {
                        setMoveHistory(data.moveHistory);
                    }
                    
                    // Restore current player if available
                    if (data.currentPlayer !== undefined) {
                        setCurrentPlayer(data.currentPlayer);
                    }
                    
                    setStatusMessage(`Position imported: ${data.description || 'Unknown position'}`);
                }).catch(error => {
                    setStatusMessage(`Failed to load imported position: ${error.message}`);
                });
            } catch (error) {
                setStatusMessage(`Invalid position file: ${error.message}`);
            }
        };
        reader.readAsText(file);
    }, []);
    
    const handleFileImport = React.useCallback((e) => {
        const file = e.target.files[0];
        if (file) {
            importPosition(file);
        }
        // Reset the input value so the same file can be selected again
        e.target.value = '';
    }, [importPosition]);
    
    // Context menu functions
    const showContextMenu = React.useCallback((e, elementType, elementData) => {
        e.preventDefault();
        const options = getMenuOptions(elementType, elementData);
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            options: options
        });
    }, []);
    
    const hideContextMenu = React.useCallback(() => {
        setContextMenu({ visible: false, x: 0, y: 0, options: [] });
    }, []);
    
    const handleContextMenuAction = React.useCallback((action) => {
        console.log('Context menu action:', action);
        hideContextMenu();
        setStatusMessage(`Action: ${action}`);
    }, [hideContextMenu]);
    
    // Expose functions globally for components
    React.useEffect(() => {
        window.showContextMenu = showContextMenu;
        window.hideContextMenu = hideContextMenu;
        window.handleEditClick = handleEditClick;
    }, [showContextMenu, hideContextMenu, handleEditClick]);
    
    // Handle clicks outside context menu
    React.useEffect(() => {
        const handleClickOutside = () => hideContextMenu();
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, [hideContextMenu]);
    
    // Undo/Redo functionality
    const handleUndo = React.useCallback(() => {
        if (moveHistory.length === 0) return;
        
        const lastMove = moveHistory[moveHistory.length - 1];
        // For now, just remove from history - full undo would need state restoration
        setMoveHistory(prev => prev.slice(0, -1));
        setStatusMessage(`Undid move: ${JSON.stringify(lastMove.move)}`);
    }, [moveHistory]);
    
    const handleRedo = React.useCallback(() => {
        // TODO: Implement proper redo with state stack
        setStatusMessage('Redo functionality coming soon');
    }, []);
    
    // Keyboard shortcuts
    React.useEffect(() => {
        const handleKeyPress = (e) => {
            if (e.key === 'Escape') {
                clearSelection();
            } else if (e.key === 'e' && e.ctrlKey) {
                e.preventDefault();
                setEditMode(!editMode);
            } else if (e.key === 'z' && e.ctrlKey) {
                e.preventDefault();
                handleUndo();
            } else if (e.key === 'y' && e.ctrlKey) {
                e.preventDefault();
                handleRedo();
            }
        };
        
        document.addEventListener('keydown', handleKeyPress);
        return () => document.removeEventListener('keydown', handleKeyPress);
    }, [clearSelection, editMode, handleUndo, handleRedo]);
    
    // Update body class for edit mode
    React.useEffect(() => {
        document.body.classList.toggle('edit-mode', editMode);
    }, [editMode]);
    
    if (!gameState) {
        return React.createElement('div', {
            className: 'flex items-center justify-center min-h-screen'
        },
            React.createElement('div', {
                className: 'text-center'
            },
                React.createElement('h1', {
                    className: 'text-2xl font-bold mb-4'
                }, 'Azul Solver & Analysis Toolkit'),
                React.createElement(StatusMessage, {
                    type: sessionStatus === 'connected' ? 'success' : 'error',
                    message: statusMessage
                })
            )
        );
    }
    
    return React.createElement('div', {
        className: 'min-h-screen bg-gray-100'
    },
        // Header
        React.createElement('header', {
            className: 'bg-white shadow-sm border-b'
        },
            React.createElement('div', {
                className: 'max-w-7xl mx-auto px-4 py-4'
            },
                React.createElement('div', {
                    className: 'flex justify-between items-center'
                },
                    React.createElement('h1', {
                        className: 'text-2xl font-bold text-gray-900'
                    }, 'Azul Solver & Analysis Toolkit'),
                    React.createElement('div', {
                        className: 'flex space-x-4'
                    },
                        React.createElement('button', {
                            className: `btn-edit ${editMode ? 'active' : ''}`,
                            onClick: handleEditModeToggle
                        }, editMode ? '✏️ Exit Edit' : '✏️ Edit Mode'),
                        React.createElement('button', {
                            className: 'btn-success',
                            onClick: () => getGameState().then(setGameState)
                        }, '🔄 Reset Game'),
                        React.createElement('button', {
                            className: 'btn-primary btn-sm',
                            onClick: () => {
                                getGameState().then(data => {
                                    setGameState(data);
                                    setStatusMessage('Game state refreshed');
                                }).catch(error => {
                                    setStatusMessage(`Refresh failed: ${error.message}`);
                                });
                            }
                        }, '🔄 Refresh'),
                        React.createElement('div', {
                            className: 'btn-group'
                        },
                            React.createElement('button', {
                                className: 'btn-info btn-sm',
                                onClick: exportPosition,
                                disabled: !gameState
                            }, '💾 Export'),
                            React.createElement('label', {
                                className: 'btn-info btn-sm cursor-pointer',
                                htmlFor: 'position-import'
                            }, '📁 Import'),
                            React.createElement('input', {
                                id: 'position-import',
                                type: 'file',
                                accept: '.json',
                                onChange: handleFileImport,
                                style: { display: 'none' }
                            })
                        )
                    )
                )
            )
        ),
        
        // Main content
        React.createElement('div', {
            className: 'max-w-7xl mx-auto px-4 py-8'
        },
            // Status message and current player
            React.createElement('div', {
                className: 'mb-4 space-y-2'
            },
                React.createElement(StatusMessage, {
                    type: sessionStatus === 'connected' ? 'success' : 'error',
                    message: statusMessage
                }),
                React.createElement('div', {
                    className: 'flex justify-between items-center p-3 bg-blue-50 rounded-lg'
                },
                    React.createElement('div', {
                        className: 'flex items-center space-x-2'
                    },
                        React.createElement('span', {
                            className: 'font-medium'
                        }, `Current Player: ${currentPlayer + 1}`),
                        engineThinking && React.createElement('span', {
                            className: 'text-sm text-blue-600'
                        }, '🤖 Engine thinking...')
                    ),
                    React.createElement('div', {
                        className: 'text-sm text-gray-600'
                    }, `Moves: ${moveHistory.length}`)
                )
            ),
            
            // Game board
            React.createElement('div', {
                className: 'grid grid-cols-1 lg:grid-cols-3 gap-8'
            },
                // Factories
                React.createElement('div', {
                    className: 'lg:col-span-2'
                },
                    React.createElement('h2', {
                        className: 'text-xl font-semibold mb-4'
                    }, 'Factories'),
                    React.createElement('div', {
                        className: 'grid grid-cols-5 gap-4'
                    },
                        (gameState.factories || []).map((factory, index) => 
                            React.createElement(Factory, {
                                key: index,
                                tiles: factory,
                                factoryIndex: index,
                                onTileClick: (factoryIndex, tileIndex, tile) => {
                                    setSelectedTile({ sourceId: factoryIndex, tileIndex, tile });
                                    setStatusMessage(`Selected ${tile} from factory ${factoryIndex}`);
                                },
                                selectedTile: selectedTile,
                                editMode: editMode,
                                onElementSelect: handleElementSelect,
                                selectedElement: selectedElement,
                                heatmapEnabled: heatmapEnabled,
                                heatmapData: heatmapData
                            })
                        )
                    )
                ),
                
                // Analysis panel
                React.createElement('div', {
                    className: 'lg:col-span-1'
                },
                    React.createElement('h2', {
                        className: 'text-xl font-semibold mb-4'
                    }, 'Analysis & Controls'),
                    React.createElement('div', {
                        className: 'space-y-4'
                    },
                        // Action buttons
                        React.createElement('div', {
                            className: 'btn-group w-full'
                        },
                            React.createElement('button', {
                                className: 'btn-warning btn-sm flex-1',
                                onClick: handleUndo,
                                disabled: moveHistory.length === 0 || loading
                            }, '↶ Undo'),
                            React.createElement('button', {
                                className: 'btn-secondary btn-sm flex-1',
                                onClick: handleRedo,
                                disabled: loading
                            }, '↷ Redo')
                        ),
                        
                        // Analysis and heatmap buttons
                        React.createElement('div', {
                            className: 'space-y-3'
                        },
                            React.createElement('button', {
                                className: `w-full btn-primary ${loading ? 'opacity-50' : ''}`,
                                onClick: () => {
                                    setLoading(true);
                                    analyzePosition(gameState.fen_string || 'initial')
                                        .then(data => {
                                            setVariations(data.variations || []);
                                            const heatmap = generateHeatmapData(data);
                                            setHeatmapData(heatmap);
                                            setStatusMessage('Analysis complete');
                                        })
                                        .catch(error => {
                                            setStatusMessage(`Analysis failed: ${error.message}`);
                                        })
                                        .finally(() => setLoading(false));
                                },
                                disabled: loading
                            }, loading ? '🤖 Analyzing...' : '🔍 Analyze Position'),
                            
                            React.createElement('button', {
                                className: `w-full btn-sm ${heatmapEnabled ? 'btn-success' : 'btn-secondary'}`,
                                onClick: () => {
                                    setHeatmapEnabled(!heatmapEnabled);
                                    setStatusMessage(heatmapEnabled ? 'Heatmap disabled' : 'Heatmap enabled');
                                },
                                disabled: !heatmapData
                            }, heatmapEnabled ? '🔥 Hide Heatmap' : '🔥 Show Heatmap')
                        ),
                        
                        // Move variations
                        variations.length > 0 && React.createElement('div', null,
                            React.createElement('h3', {
                                className: 'font-medium mb-2'
                            }, 'Best Moves'),
                            variations.map((variation, index) => 
                                React.createElement(MoveOption, {
                                    key: index,
                                    move: variation.move,
                                    score: variation.score,
                                    visits: variation.visits,
                                    onClick: () => setStatusMessage(`Selected: ${variation.move}`),
                                    isSelected: false
                                })
                            )
                        ),
                        
                        // Edit Controls Panel (only show when edit mode is active)
                        editMode && React.createElement('div', {
                            className: 'edit-controls mt-6 p-4'
                        },
                            React.createElement('h3', {
                                className: 'font-medium mb-3'
                            }, '✏️ Edit Controls'),
                            React.createElement('div', {
                                className: 'space-y-3'
                            },
                                // Edit Actions
                                React.createElement('div', {
                                    className: 'btn-group w-full'
                                },
                                    React.createElement('button', {
                                        className: 'btn-warning btn-sm flex-1',
                                        onClick: () => handleEditAction('add', 'blue')
                                    }, '➕ Add'),
                                    React.createElement('button', {
                                        className: 'btn-danger btn-sm flex-1',
                                        onClick: () => handleEditAction('remove', 'tile')
                                    }, '➖ Remove'),
                                    React.createElement('button', {
                                        className: 'btn-info btn-sm flex-1',
                                        onClick: () => handleEditAction('move', 'tile')
                                    }, '↔️ Move')
                                ),
                                
                                // Tile Color Selection (for add action)
                                editAction === 'add' && React.createElement('div', {
                                    className: 'space-y-2'
                                },
                                    React.createElement('p', {
                                        className: 'text-sm text-orange-700'
                                    }, 'Select tile color:'),
                                    React.createElement('div', {
                                        className: 'tile-color-grid'
                                    },
                                        ['B', 'Y', 'R', 'K', 'W'].map(color => 
                                            React.createElement('button', {
                                                key: color,
                                                className: `tile-color-button ${getTileColor(color)} ${editTarget === color ? 'selected' : ''}`,
                                                onClick: () => handleEditAction('add', color)
                                            })
                                        )
                                    )
                                ),
                                
                                // Current Action Status
                                editAction && React.createElement('div', {
                                    className: 'edit-action-status'
                                },
                                    React.createElement('strong', null, 'Current Action: '),
                                    editAction === 'add' ? `Add ${editTarget} tiles` :
                                    editAction === 'remove' ? 'Remove tiles' :
                                    editAction === 'move' ? 'Move tiles' : 'Select action'
                                ),
                                
                                // Clear Action Button
                                editAction && React.createElement('button', {
                                    className: 'w-full btn-secondary btn-sm',
                                    onClick: () => {
                                        setEditAction(null);
                                        setEditTarget(null);
                                        setStatusMessage('Edit action cleared');
                                    }
                                }, '❌ Clear Action')
                            )
                        ),
                        
                        // Move history
                        moveHistory.length > 0 && React.createElement('div', null,
                            React.createElement('h3', {
                                className: 'font-medium mb-2'
                            }, 'Move History'),
                            React.createElement('div', {
                                className: 'max-h-40 overflow-y-auto space-y-1'
                            },
                                moveHistory.slice(-5).map((historyItem, index) => 
                                    React.createElement('div', {
                                        key: index,
                                        className: 'text-xs p-2 bg-gray-100 rounded'
                                    },
                                        React.createElement('div', {
                                            className: 'font-medium'
                                        }, `Player ${historyItem.player + 1}`),
                                        React.createElement('div', null, historyItem.result.move_executed || 'Move executed')
                                    )
                                )
                            )
                        )
                    )
                )
            ),
            
            // Player boards
            React.createElement('div', {
                className: 'mt-8'
            },
                React.createElement('h2', {
                    className: 'text-xl font-semibold mb-4'
                }, 'Player Boards'),
                (gameState.players || []).map((player, index) => 
                    React.createElement(PlayerBoard, {
                        key: index,
                        player: player,
                        playerIndex: index,
                        isActive: index === currentPlayer,
                        editMode: editMode,
                        onElementSelect: handleElementSelect,
                        selectedElement: selectedElement,
                        onPatternLineDrop: handlePatternLineDrop,
                        onPlayerSwitch: (playerId) => setCurrentPlayer(playerId),
                        canInteract: !loading && !engineThinking
                    })
                )
            ),
            
            // Debug panel
            React.createElement('div', {
                className: 'mt-4 p-4 bg-gray-50 rounded-lg'
            },
                React.createElement('h3', {
                    className: 'font-semibold mb-2'
                }, 'Debug Info'),
                React.createElement('div', {
                    className: 'text-xs space-y-1'
                },
                    React.createElement('div', null, `Session: ${sessionId ? 'Connected' : 'Disconnected'}`),
                    React.createElement('div', null, `Game State: ${gameState ? 'Loaded' : 'Loading'}`),
                    React.createElement('div', null, `Factories: ${gameState?.factories?.length || 0}`),
                    React.createElement('div', null, `Players: ${gameState?.players?.length || 0}`),
                    React.createElement('details', null,
                        React.createElement('summary', {
                            className: 'cursor-pointer font-medium'
                        }, 'Server State'),
                        React.createElement('pre', {
                            className: 'text-xs mt-2 bg-white p-2 rounded overflow-auto max-h-40'
                        }, gameState ? JSON.stringify(gameState, null, 2) : 'Loading...')
                    )
                )
            ),
            
            // Selected element display
            selectedElement && React.createElement('div', {
                className: 'mt-4 p-4 bg-blue-50 rounded-lg'
            },
                React.createElement('h3', {
                    className: 'font-semibold mb-2'
                }, 'Selected Element'),
                React.createElement('pre', {
                    className: 'text-sm'
                }, formatSelectedElement(selectedElement))
            )
        ),
        
        // Context menu
        React.createElement(ContextMenu, {
            visible: contextMenu.visible,
            x: contextMenu.x,
            y: contextMenu.y,
            options: contextMenu.options,
            onAction: handleContextMenuAction,
            onClose: hideContextMenu
        })
    );
}

// Render the app
const root = createRoot(document.getElementById('root'));
root.render(React.createElement(App));