// Main entry point for the React app
// Using global React and ReactDOM from CDN

const { createRoot } = ReactDOM;

// Import utility functions (these will be defined inline)
const API_BASE = '/api/v1';
let sessionId = null;

// Simple Router Component
function Router({ currentPage, onPageChange, children }) {
    return React.createElement('div', { className: 'router' }, children);
}

// Navigation Component
function Navigation({ currentPage, onPageChange }) {
    return React.createElement('nav', { className: 'navigation bg-white shadow-md p-4 mb-4' },
        React.createElement('div', { className: 'flex justify-between items-center' },
            React.createElement('h1', { className: 'text-xl font-bold text-gray-800' }, 'Azul Solver & Analysis Toolkit'),
            React.createElement('div', { className: 'flex space-x-4' },
                React.createElement('button', {
                    className: `px-4 py-2 rounded ${currentPage === 'main' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`,
                    onClick: () => onPageChange('main')
                }, 'Main Interface'),
                React.createElement('button', {
                    className: `px-4 py-2 rounded ${currentPage === 'neural' ? 'bg-purple-600 text-white' : 'bg-gray-200 text-gray-700'}`,
                    onClick: () => onPageChange('neural')
                }, '🧠 Neural Training')
            )
        )
    );
}

// Neural Training Page Component
function NeuralTrainingPage({ 
    loading, setLoading, setStatusMessage,
    trainingConfig, setTrainingConfig,
    neuralExpanded, setNeuralExpanded
}) {
    const [activeTab, setActiveTab] = React.useState('training');
    const [trainingStatus, setTrainingStatus] = React.useState(null);
    const [trainingProgress, setTrainingProgress] = React.useState(null);
    const [availableModels, setAvailableModels] = React.useState([]);
    const [evaluationResults, setEvaluationResults] = React.useState(null);

    // Load available models on component mount
    React.useEffect(() => {
        loadAvailableModels();
    }, []);

    const loadAvailableModels = async () => {
        try {
            const models = await getAvailableModels();
            setAvailableModels(models.models || []);
        } catch (error) {
            console.error('Failed to load models:', error);
            setStatusMessage('error', 'Failed to load available models');
        }
    };

    const handleStartTraining = async () => {
        setLoading(true);
        setTrainingStatus(null);
        try {
            console.log('Starting neural training with config:', trainingConfig);
            const result = await startNeuralTraining(trainingConfig);
            console.log('Training result:', result);
            
            if (result.success) {
                setStatusMessage('success', 'Training started in background!');
                setTrainingStatus(result);
                
                // Start polling for status updates
                const sessionId = result.session_id;
                const pollInterval = setInterval(async () => {
                    try {
                        const statusResult = await getNeuralTrainingStatus(sessionId);
                        setTrainingStatus(statusResult);
                        
                        if (statusResult.status === 'completed' || statusResult.status === 'failed' || statusResult.status === 'stopped') {
                            clearInterval(pollInterval);
                            setLoading(false);
                            
                            if (statusResult.status === 'completed') {
                                setStatusMessage('success', 'Training completed successfully!');
                            } else if (statusResult.status === 'failed') {
                                setStatusMessage('error', `Training failed: ${statusResult.error || 'Unknown error'}`);
                            } else {
                                setStatusMessage('info', 'Training stopped by user');
                            }
                        }
                    } catch (error) {
                        console.error('Failed to get training status:', error);
                        clearInterval(pollInterval);
                        setLoading(false);
                        setStatusMessage('error', 'Failed to get training status');
                    }
                }, 2000); // Poll every 2 seconds
                
            } else {
                setStatusMessage('error', `Training failed: ${result.message || 'Unknown error'}`);
                setTrainingStatus({ success: false, message: result.message || 'Unknown error' });
                setLoading(false);
            }
        } catch (error) {
            console.error('Failed to start training:', error);
            setTrainingStatus({ success: false, message: error.message || 'Network error' });
            setStatusMessage('error', `Failed to start training: ${error.message || 'Network error'}`);
            setLoading(false);
        }
    };

    const handleEvaluateModel = async (modelConfig) => {
        setLoading(true);
        try {
            const result = await evaluateNeuralModel(modelConfig);
            setEvaluationResults(result);
            setStatusMessage('success', 'Model evaluation completed');
        } catch (error) {
            console.error('Failed to evaluate model:', error);
            setStatusMessage('error', 'Failed to evaluate model');
        } finally {
            setLoading(false);
        }
    };

    return React.createElement('div', { className: 'neural-training-page p-6' },
        // Page Header
        React.createElement('div', { className: 'mb-6' },
            React.createElement('h1', { className: 'text-3xl font-bold text-purple-800 mb-2' }, '🧠 Neural Training Interface'),
            React.createElement('p', { className: 'text-gray-600' }, 'Train, evaluate, and manage neural network models for Azul analysis')
        ),

        // Tab Navigation
        React.createElement('div', { className: 'mb-6' },
            React.createElement('div', { className: 'flex border-b border-gray-200' },
                React.createElement('button', {
                    className: `px-4 py-2 ${activeTab === 'training' ? 'border-b-2 border-purple-600 text-purple-600' : 'text-gray-500'}`,
                    onClick: () => setActiveTab('training')
                }, 'Training Configuration'),
                React.createElement('button', {
                    className: `px-4 py-2 ${activeTab === 'monitor' ? 'border-b-2 border-purple-600 text-purple-600' : 'text-gray-500'}`,
                    onClick: () => setActiveTab('monitor')
                }, 'Training Monitor'),
                React.createElement('button', {
                    className: `px-4 py-2 ${activeTab === 'evaluation' ? 'border-b-2 border-purple-600 text-purple-600' : 'text-gray-500'}`,
                    onClick: () => setActiveTab('evaluation')
                }, 'Model Evaluation'),
                React.createElement('button', {
                    className: `px-4 py-2 ${activeTab === 'history' ? 'border-b-2 border-purple-600 text-purple-600' : 'text-gray-500'}`,
                    onClick: () => setActiveTab('history')
                }, 'Training History')
            )
        ),

        // Tab Content
        activeTab === 'training' && React.createElement('div', { className: 'neural-training-config' },
            React.createElement('h2', { className: 'text-xl font-semibold mb-4 text-purple-700' }, 'Training Configuration'),
            React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
                // Model Configuration
                React.createElement('div', { className: 'space-y-4' },
                    React.createElement('h3', { className: 'font-semibold text-gray-700' }, 'Model Settings'),
                    React.createElement('div', { className: 'space-y-2' },
                        React.createElement('label', { className: 'block text-sm font-medium text-gray-700' }, 'Model Size'),
                        React.createElement('select', {
                            value: trainingConfig.modelSize,
                            onChange: (e) => setTrainingConfig({...trainingConfig, modelSize: e.target.value}),
                            className: 'w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent'
                        },
                            React.createElement('option', { value: 'small' }, 'Small (Fast)'),
                            React.createElement('option', { value: 'medium' }, 'Medium (Balanced)'),
                            React.createElement('option', { value: 'large' }, 'Large (Accurate)')
                        )
                    ),
                    React.createElement('div', { className: 'space-y-2' },
                        React.createElement('label', { className: 'block text-sm font-medium text-gray-700' }, 'Device'),
                        React.createElement('select', {
                            value: trainingConfig.device,
                            onChange: (e) => setTrainingConfig({...trainingConfig, device: e.target.value}),
                            className: 'w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent'
                        },
                            React.createElement('option', { value: 'cpu' }, 'CPU'),
                            React.createElement('option', { value: 'gpu' }, 'GPU (if available)')
                        )
                    )
                ),

                // Training Parameters
                React.createElement('div', { className: 'space-y-4' },
                    React.createElement('h3', { className: 'font-semibold text-gray-700' }, 'Training Parameters'),
                    React.createElement('div', { className: 'space-y-2' },
                        React.createElement('label', { className: 'block text-sm font-medium text-gray-700' }, 'Epochs'),
                        React.createElement('input', {
                            type: 'number',
                            value: trainingConfig.epochs,
                            onChange: (e) => setTrainingConfig({...trainingConfig, epochs: parseInt(e.target.value)}),
                            min: 1,
                            max: 100,
                            className: 'w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent'
                        })
                    ),
                    React.createElement('div', { className: 'space-y-2' },
                        React.createElement('label', { className: 'block text-sm font-medium text-gray-700' }, 'Samples'),
                        React.createElement('input', {
                            type: 'number',
                            value: trainingConfig.samples,
                            onChange: (e) => setTrainingConfig({...trainingConfig, samples: parseInt(e.target.value)}),
                            min: 100,
                            max: 10000,
                            className: 'w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent'
                        })
                    ),
                    React.createElement('div', { className: 'space-y-2' },
                        React.createElement('label', { className: 'block text-sm font-medium text-gray-700' }, 'Batch Size'),
                        React.createElement('input', {
                            type: 'number',
                            value: trainingConfig.batchSize,
                            onChange: (e) => setTrainingConfig({...trainingConfig, batchSize: parseInt(e.target.value)}),
                            min: 1,
                            max: 128,
                            className: 'w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent'
                        })
                    ),
                    React.createElement('div', { className: 'space-y-2' },
                        React.createElement('label', { className: 'block text-sm font-medium text-gray-700' }, 'Learning Rate'),
                        React.createElement('input', {
                            type: 'number',
                            value: trainingConfig.learningRate,
                            onChange: (e) => setTrainingConfig({...trainingConfig, learningRate: parseFloat(e.target.value)}),
                            step: 0.0001,
                            min: 0.0001,
                            max: 0.1,
                            className: 'w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent'
                        })
                    )
                )
            ),

            // Action Buttons
            React.createElement('div', { className: 'mt-6 flex space-x-4' },
                React.createElement('button', {
                    onClick: handleStartTraining,
                    disabled: loading,
                    className: 'px-8 py-3 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-200'
                }, loading ? '🚀 Starting Training...' : '🚀 Start Training'),
                React.createElement('button', {
                    onClick: () => saveNeuralConfig(trainingConfig),
                    className: 'px-6 py-3 bg-gray-600 text-white rounded-md hover:bg-gray-700 font-semibold'
                }, '💾 Save Configuration')
            ),

            // Training Status Display
            trainingStatus && React.createElement('div', { className: 'mt-4 p-4 bg-green-50 border border-green-200 rounded-md' },
                React.createElement('h4', { className: 'font-semibold text-green-800 mb-2' }, 'Training Status'),
                trainingStatus.status && React.createElement('div', { className: 'mb-3' },
                    React.createElement('div', { className: 'flex items-center justify-between mb-2' },
                        React.createElement('span', { className: 'text-sm font-medium text-gray-700' }, 
                            `Status: ${trainingStatus.status.charAt(0).toUpperCase() + trainingStatus.status.slice(1)}`
                        ),
                        trainingStatus.status === 'running' && React.createElement('button', {
                            onClick: async () => {
                                if (trainingStatus.session_id) {
                                    try {
                                        await stopNeuralTraining(trainingStatus.session_id);
                                        setStatusMessage('info', 'Training stop requested');
                                    } catch (error) {
                                        setStatusMessage('error', 'Failed to stop training');
                                    }
                                }
                            },
                            className: 'px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700'
                        }, '⏹️ Stop Training')
                    ),
                    trainingStatus.progress !== undefined && React.createElement('div', { className: 'mb-2' },
                        React.createElement('div', { className: 'w-full bg-gray-200 rounded-full h-2' },
                            React.createElement('div', { 
                                className: 'bg-purple-600 h-2 rounded-full transition-all duration-300',
                                style: { width: `${trainingStatus.progress}%` }
                            })
                        ),
                        React.createElement('p', { className: 'text-xs text-gray-600 mt-1' }, 
                            `${trainingStatus.progress}% complete`
                        )
                    )
                ),
                trainingStatus.logs && trainingStatus.logs.length > 0 && React.createElement('div', { className: 'mt-3' },
                    React.createElement('h5', { className: 'text-sm font-medium text-gray-700 mb-2' }, 'Training Logs'),
                    React.createElement('div', { className: 'bg-gray-100 p-3 rounded text-xs font-mono max-h-32 overflow-y-auto' },
                        trainingStatus.logs.map((log, index) => 
                            React.createElement('div', { key: index, className: 'text-gray-700' }, log)
                        )
                    )
                ),
                trainingStatus.results && React.createElement('div', { className: 'mt-3 p-3 bg-blue-50 rounded' },
                    React.createElement('h5', { className: 'text-sm font-medium text-blue-800 mb-2' }, 'Training Results'),
                    React.createElement('div', { className: 'text-sm text-blue-700' },
                        React.createElement('p', null, `Final Loss: ${trainingStatus.results.final_loss?.toFixed(4) || 'N/A'}`),
                        React.createElement('p', null, `Evaluation Error: ${trainingStatus.results.evaluation_error?.toFixed(4) || 'N/A'}`),
                        React.createElement('p', null, `Model Path: ${trainingStatus.results.model_path || 'N/A'}`)
                    )
                ),
                trainingStatus.error && React.createElement('div', { className: 'mt-3 p-3 bg-red-50 rounded' },
                    React.createElement('h5', { className: 'text-sm font-medium text-red-800 mb-2' }, 'Training Error'),
                    React.createElement('p', { className: 'text-sm text-red-700' }, trainingStatus.error)
                )
            ),

            // Important Note
            React.createElement('div', { className: 'mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md' },
                React.createElement('h4', { className: 'font-semibold text-blue-800 mb-2' }, 'ℹ️ Training Information'),
                React.createElement('p', { className: 'text-blue-700 text-sm' }, 
                    'Training now runs in the background. You can monitor progress and stop training at any time. The server will remain responsive during training.'
                )
            )
        ),

        activeTab === 'monitor' && React.createElement('div', { className: 'training-monitor' },
            React.createElement('h2', { className: 'text-xl font-semibold mb-4 text-purple-700' }, 'Training Monitor'),
            React.createElement('div', { className: 'bg-yellow-50 border border-yellow-200 rounded-md p-4' },
                React.createElement('p', { className: 'text-yellow-800' }, 'Training monitor features will be implemented in Part 2.1.2')
            )
        ),

        activeTab === 'evaluation' && React.createElement('div', { className: 'model-evaluator' },
            React.createElement('h2', { className: 'text-xl font-semibold mb-4 text-purple-700' }, 'Model Evaluation'),
            React.createElement('div', { className: 'bg-yellow-50 border border-yellow-200 rounded-md p-4' },
                React.createElement('p', { className: 'text-yellow-800' }, 'Model evaluation features will be implemented in Part 2.1.3')
            )
        ),

        activeTab === 'history' && React.createElement('div', { className: 'training-history' },
            React.createElement('h2', { className: 'text-xl font-semibold mb-4 text-purple-700' }, 'Training History'),
            React.createElement('div', { className: 'bg-yellow-50 border border-yellow-200 rounded-md p-4' },
                React.createElement('p', { className: 'text-yellow-800' }, 'Training history features will be implemented in Part 2.1.4')
            )
        )
    );
}

// API functions - No session required for local development
async function initializeSession() {
    // Skip session initialization for local development
    console.log('Session initialization skipped for local development');
    return { session_id: 'local-dev' };
}

async function analyzePosition(fenString, depth = 3, timeBudget = 4.0, agentId = 0) {
    try {
        const response = await fetch(`${API_BASE}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                fen_string: fenString,
                depth: depth,
                time_budget: timeBudget,
                agent_id: agentId
            })
        });
        return await response.json();
    } catch (error) {
        console.error('Failed to analyze position:', error);
        throw error;
    }
}

async function getHint(fenString, budget = 0.2, rollouts = 100, agentId = 0) {
    try {
        const response = await fetch(`${API_BASE}/hint`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                fen_string: fenString,
                budget: budget,
                rollouts: rollouts,
                agent_id: agentId
            })
        });
        return await response.json();
    } catch (error) {
        console.error('Failed to get hint:', error);
        throw error;
    }
}

async function analyzeNeural(fenString, timeBudget = 2.0, maxRollouts = 100, agentId = 0) {
    try {
        const response = await fetch(`${API_BASE}/analyze_neural`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                fen: fenString,
                time_budget: timeBudget,
                max_rollouts: maxRollouts,
                agent_id: agentId
            })
        });
        return await response.json();
    } catch (error) {
        console.error('Failed to analyze with neural network:', error);
        throw error;
    }
}

async function analyzeGame(gameData, analysisDepth = 3) {
    try {
        const response = await fetch(`${API_BASE}/analyze_game`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                game_data: gameData,
                analysis_depth: analysisDepth
            })
        });
        return await response.json();
    } catch (error) {
        console.error('Failed to analyze game:', error);
        throw error;
    }
}

// Neural Training API Functions
async function startNeuralTraining(config) {
    try {
        const response = await fetch(`${API_BASE}/neural/train`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        return await response.json();
    } catch (error) {
        console.error('Failed to start neural training:', error);
        throw error;
    }
}

async function getNeuralTrainingStatus(sessionId) {
    try {
        const response = await fetch(`${API_BASE}/neural/status/${sessionId}`);
        return await response.json();
    } catch (error) {
        console.error('Failed to get training status:', error);
        throw error;
    }
}

async function getNeuralTrainingProgress(sessionId) {
    try {
        const response = await fetch(`${API_BASE}/neural/progress/${sessionId}`);
        return await response.json();
    } catch (error) {
        console.error('Failed to get training progress:', error);
        throw error;
    }
}

async function getNeuralTrainingLogs(sessionId) {
    try {
        const response = await fetch(`${API_BASE}/neural/logs/${sessionId}`);
        return await response.json();
    } catch (error) {
        console.error('Failed to get training logs:', error);
        throw error;
    }
}

async function stopNeuralTraining(sessionId) {
    try {
        const response = await fetch(`${API_BASE}/neural/stop/${sessionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        return await response.json();
    } catch (error) {
        console.error('Failed to stop training:', error);
        throw error;
    }
}

async function evaluateNeuralModel(config) {
    try {
        const response = await fetch(`${API_BASE}/neural/evaluate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        return await response.json();
    } catch (error) {
        console.error('Failed to evaluate model:', error);
        throw error;
    }
}

async function getAvailableModels() {
    try {
        const response = await fetch(`${API_BASE}/neural/models`);
        return await response.json();
    } catch (error) {
        console.error('Failed to get available models:', error);
        throw error;
    }
}

async function getNeuralConfig() {
    try {
        const response = await fetch(`${API_BASE}/neural/config`);
        return await response.json();
    } catch (error) {
        console.error('Failed to get neural config:', error);
        throw error;
    }
}

async function saveNeuralConfig(config) {
    try {
        const response = await fetch(`${API_BASE}/neural/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        return await response.json();
    } catch (error) {
        console.error('Failed to save neural config:', error);
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

async function saveGameState(gameState, fenString = 'initial') {
    try {
        const response = await fetch(`${API_BASE}/game_state`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                fen_string: fenString,
                game_state: gameState
            })
        });
        return await response.json();
    } catch (error) {
        console.error('Failed to save game state:', error);
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
function Factory({ tiles, onTileClick, heatmap = null, factoryIndex, selectedTile = null, onTileSelection = null, editMode = false, onElementSelect = null, selectedElements = [], heatmapEnabled = false, heatmapData = null }) {
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
            const isCtrlClick = e.ctrlKey;
            onElementSelect({
                type: 'factory',
                data: { factoryIndex, tiles }
            }, isCtrlClick);
        }
    };
    
    const handleFactoryRightClick = (e) => {
        e.preventDefault();
        if (editMode && window.showContextMenu) {
            window.showContextMenu(e, 'factory', { factoryIndex, tiles });
        }
    };
    
    const isSelected = editMode && selectedElements.some(el => el.type === 'factory' && el.data.factoryIndex === factoryIndex);
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
        // Factory label
        React.createElement('div', {
            className: 'text-xs text-gray-600 mb-1 text-center font-medium'
        }, `Factory ${factoryIndex + 1}`),
        React.createElement('div', {
            className: 'flex flex-wrap gap-1'
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
        )
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
function PatternLine({ tiles, rowIndex, maxTiles, onTileClick, onDrop, selectedTile = null, onDestinationClick = null, editMode = false, onElementSelect = null, playerIndex = null, selectedElements = [] }) {
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
            const isCtrlClick = e.ctrlKey;
            onElementSelect({
                type: 'pattern-line',
                data: { playerIndex, rowIndex, tiles, maxTiles }
            }, isCtrlClick);
        }
    };
    
    const handlePatternLineRightClick = (e) => {
        e.preventDefault();
        if (editMode && window.showContextMenu) {
            window.showContextMenu(e, 'pattern-line', { playerIndex, rowIndex, tiles });
        }
    };
    
    const isSelected = editMode && selectedElements.some(el => el.type === 'pattern-line' && el.data.rowIndex === rowIndex && el.data.playerIndex === playerIndex);
    const isEditSelected = editMode && isSelected;
    
    return React.createElement('div', {
        ref: patternLineRef,
        className: `pattern-line ${isEditSelected ? 'selected' : ''}`,
        onClick: handlePatternLineClick,
        onContextMenu: handlePatternLineRightClick
    },
        React.createElement('div', {
            className: 'flex items-center gap-2'
        },
            // Row label - more compact
            React.createElement('div', {
                className: 'text-xs text-gray-600 font-medium w-8 flex-shrink-0'
            }, `R${rowIndex + 1}`),
            React.createElement('div', {
                className: 'flex gap-1 flex-wrap'
            },
                tiles.map((tile, index) => 
                    React.createElement(Tile, {
                        key: index,
                        color: tile,
                        className: 'w-6 h-6',
                        onClick: () => onTileClick ? onTileClick(rowIndex, index, tile) : null
                    })
                ),
                Array.from({ length: maxTiles - tiles.length }, (_, index) => 
                    React.createElement('div', {
                        key: `empty-${index}`,
                        className: 'w-6 h-6 border border-gray-300 rounded bg-gray-50',
                        onClick: () => onDestinationClick ? onDestinationClick(rowIndex, tiles.length + index) : null
                    })
                )
            )
        )
    );
}

// Wall Component
function Wall({ wall, onWallClick, onDrop, selectedTile = null, onDestinationClick = null, editMode = false, onElementSelect = null, playerIndex = null, selectedElements = [] }) {
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
        // Column labels - more compact
        React.createElement('div', {
            className: 'flex gap-1 mb-1'
        },
            React.createElement('div', { 
                className: 'w-6 h-4 text-xs text-gray-500 font-medium flex items-center justify-center' 
            }, ''),
            ['B', 'Y', 'R', 'K', 'W'].map((color, index) => 
                React.createElement('div', {
                    key: index,
                    className: 'w-6 h-4 text-xs text-gray-600 font-medium flex items-center justify-center'
                }, color)
            )
        ),
        wall.map((row, rowIndex) => 
            React.createElement('div', {
                key: rowIndex,
                className: 'flex gap-1 mb-1'
            },
                // Row label - more compact
                React.createElement('div', {
                    className: 'w-6 h-6 text-xs text-gray-600 font-medium flex items-center justify-center'
                }, `R${rowIndex + 1}`),
                row.map((cell, colIndex) => {
                    const isSelected = editMode && selectedElements.some(el => 
                        el.type === 'wall-cell' && 
                        el.data.playerIndex === playerIndex && 
                        el.data.rowIndex === rowIndex && 
                        el.data.colIndex === colIndex
                    );
                    
                    return React.createElement('div', {
                        key: colIndex,
                        className: `w-6 h-6 border border-gray-300 rounded flex items-center justify-center ${cell ? 'bg-gray-100' : 'bg-white'} ${isSelected ? 'ring-2 ring-blue-500' : ''}`,
                        onClick: (e) => {
                            if (editMode && onElementSelect) {
                                const isCtrlClick = e.ctrlKey;
                                onElementSelect({
                                    type: 'wall-cell',
                                    data: { playerIndex, rowIndex, colIndex, cell }
                                }, isCtrlClick);
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
                        cell ? React.createElement(Tile, { 
                            color: cell,
                            className: 'w-4 h-4'
                        }) : null
                    );
                })
            )
        )
    );
}

// PlayerBoard Component
function PlayerBoard({ player, playerIndex, onPatternLineClick, onWallClick, onPatternLineDrop, onWallDrop, selectedTile = null, onDestinationClick = null, isActive = false, onPlayerSwitch = null, canInteract = true, gameMode = 'sandbox', editMode = false, onElementSelect = null, selectedElements = [] }) {
    const borderClass = isActive ? 'border-4 border-blue-500 bg-blue-50' : 'border-2 border-gray-300 bg-gray-50';
    const headerClass = isActive ? 'text-blue-700 font-bold' : 'text-gray-700';
    
    return React.createElement('div', {
        className: `player-board ${borderClass} p-3 rounded-lg mb-3`
    },
        React.createElement('div', {
            className: `flex justify-between items-center mb-3 ${headerClass}`
        },
            React.createElement('h3', {
                className: 'text-lg font-semibold'
            }, `Player ${playerIndex + 1}`),
            React.createElement('div', {
                className: 'flex space-x-2 items-center'
            },
                React.createElement('button', {
                    className: 'px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600',
                    onClick: () => onPlayerSwitch ? onPlayerSwitch(playerIndex) : null
                }, 'Switch'),
                React.createElement('span', {
                    className: 'text-sm font-medium'
                }, `Score: ${player.score || 0}`)
            )
        ),
        React.createElement('div', {
            className: 'grid grid-cols-2 gap-3'
        },
            React.createElement('div', {
                className: 'pattern-lines'
            },
                React.createElement('h4', {
                    className: 'text-sm font-medium mb-2 text-gray-700'
                }, 'Pattern Lines'),
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
                        selectedElements: selectedElements
                    })
                )
            ),
            React.createElement('div', {
                className: 'wall-section'
            },
                React.createElement('h4', {
                    className: 'text-sm font-medium mb-2 text-gray-700'
                }, 'Wall'),
                React.createElement(Wall, {
                    wall: player.wall,
                    onWallClick: onWallClick,
                    onDrop: onWallDrop,
                    selectedTile: selectedTile,
                    onDestinationClick: onDestinationClick,
                    editMode: editMode,
                    onElementSelect: onElementSelect,
                    playerIndex: playerIndex,
                    selectedElements: selectedElements
                })
            )
        ),
        React.createElement('div', {
            className: 'floor-line mt-3'
        },
            React.createElement('h4', {
                className: 'text-sm font-medium mb-2 text-gray-700'
            }, 'Floor Line'),
            React.createElement('div', {
                className: 'flex flex-wrap gap-1'
            },
                (player.floor || []).map((tile, index) => 
                    React.createElement(Tile, {
                        key: index,
                        color: tile,
                        className: 'w-5 h-5'
                    })
                ),
                Array.from({ length: 7 - (player.floor || []).length }, (_, index) => 
                    React.createElement('div', {
                        key: `empty-floor-${index}`,
                        className: 'w-5 h-5 border border-gray-300 rounded',
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

// AdvancedAnalysisControls Component
function AdvancedAnalysisControls({ loading, setLoading, analyzePosition, getHint, analyzeNeural, gameState, setVariations, setHeatmapData, setStatusMessage, moveHistory, analyzeGame, depth, setDepth, timeBudget, setTimeBudget, rollouts, setRollouts, agentId, setAgentId }) {

    const handleAnalyze = React.useCallback(() => {
        setLoading(true);
        analyzePosition(gameState.fen_string || 'initial', depth, timeBudget, agentId)
            .then(data => {
                if (data.success && data.analysis) {
                    setVariations([{
                        move: data.analysis.best_move,
                        score: data.analysis.best_score,
                        visits: data.analysis.nodes_searched
                    }]);
                    const heatmap = generateHeatmapData({ variations: [{
                        move: data.analysis.best_move,
                        score: data.analysis.best_score,
                        move_data: { source_id: 0, tile_type: 0 }
                    }] });
                    setHeatmapData(heatmap);
                    setStatusMessage(`Analysis complete: ${data.analysis.best_move} (${data.analysis.best_score.toFixed(2)})`);
                } else {
                    setStatusMessage('Analysis failed: Invalid response');
                }
            })
            .catch(error => {
                setStatusMessage(`Analysis failed: ${error.message}`);
            })
            .finally(() => setLoading(false));
    }, [loading, setLoading, analyzePosition, gameState, depth, timeBudget, rollouts, agentId, setVariations, setHeatmapData, setStatusMessage]);

    const handleQuickHint = React.useCallback(() => {
        setLoading(true);
        getHint(gameState.fen_string || 'initial', timeBudget, rollouts, agentId)
            .then(data => {
                if (data.success && data.hint) {
                    setStatusMessage(`Hint: ${data.hint.best_move} (EV: ${data.hint.expected_value.toFixed(2)})`);
                } else {
                    setStatusMessage('Hint failed: Invalid response');
                }
            })
            .catch(error => {
                setStatusMessage(`Hint failed: ${error.message}`);
            })
            .finally(() => setLoading(false));
    }, [loading, setLoading, getHint, gameState, timeBudget, rollouts, agentId, setStatusMessage]);

    const handleNeuralAnalysis = React.useCallback(() => {
        setLoading(true);
        analyzeNeural(gameState.fen_string || 'initial', 2.0, 100, agentId)
            .then(data => {
                if (data.success && data.analysis) {
                    setStatusMessage(`Neural: ${data.analysis.best_move} (${data.analysis.best_score.toFixed(2)})`);
                } else {
                    setStatusMessage('Neural analysis failed: Invalid response');
                }
            })
            .catch(error => {
                setStatusMessage(`Neural analysis failed: ${error.message}`);
            })
            .finally(() => setLoading(false));
    }, [loading, setLoading, analyzeNeural, gameState, agentId, setStatusMessage]);

    return React.createElement('div', {
        className: 'space-y-3'
    },
        React.createElement('div', {
            className: 'flex items-center space-x-2'
        },
            React.createElement('button', {
                className: `btn-primary btn-sm flex-1 ${loading ? 'opacity-50' : ''}`,
                onClick: handleAnalyze,
                disabled: loading
            }, loading ? '🤖 Analyzing...' : '🔍 Engine Analysis'),
            React.createElement('button', {
                className: `btn-info btn-sm flex-1 ${loading ? 'opacity-50' : ''}`,
                onClick: handleQuickHint,
                disabled: loading
            }, loading ? '💡 Thinking...' : '💡 Quick Hint')
        ),
        React.createElement('div', {
            className: 'flex items-center space-x-2'
        },
            React.createElement('button', {
                className: `btn-accent btn-sm flex-1 ${loading ? 'opacity-50' : ''}`,
                onClick: handleNeuralAnalysis,
                disabled: loading
            }, loading ? '🧠 Processing...' : '🧠 Neural Net'),
            React.createElement('button', {
                className: `btn-sm flex-1 ${loading ? 'btn-secondary opacity-50' : 'btn-outline'}`,
                onClick: () => {
                    setLoading(true);
                    const gameData = {
                        moves: moveHistory.map((move, index) => ({
                            move: move,
                            player: index % 2,
                            position_before: 'initial'
                        })),
                        players: ['Player 1', 'Player 2'],
                        result: { winner: null, score: [0, 0] }
                    };
                    
                    analyzeGame(gameData, 3)
                        .then(data => {
                            if (data.success) {
                                const blunderCount = data.summary.blunder_count;
                                setStatusMessage(`Game analysis complete: ${blunderCount} blunders found`);
                            } else {
                                setStatusMessage('Game analysis failed');
                            }
                        })
                        .catch(error => {
                            setStatusMessage(`Game analysis failed: ${error.message}`);
                        })
                        .finally(() => setLoading(false));
                },
                disabled: loading || moveHistory.length === 0
            }, loading ? '📊 Analyzing Game...' : '📊 Analyze Full Game')
        )
    );
}

// Configuration Panel Component
function ConfigurationPanel({ 
    loading, setLoading, setStatusMessage,
    databasePath, setDatabasePath,
    modelPath, setModelPath,
    defaultTimeout, setDefaultTimeout,
    defaultDepth, setDefaultDepth,
    defaultRollouts, setDefaultRollouts,
    configExpanded, setConfigExpanded
}) {
    const [configLoading, setConfigLoading] = React.useState(false);
    
    // Load configuration from localStorage on mount
    React.useEffect(() => {
        const savedConfig = localStorage.getItem('azul_config');
        if (savedConfig) {
            try {
                const config = JSON.parse(savedConfig);
                setDatabasePath(config.databasePath || 'azul_cache.db');
                setModelPath(config.modelPath || 'models/azul_net_small.pth');
                setDefaultTimeout(config.defaultTimeout || 4.0);
                setDefaultDepth(config.defaultDepth || 3);
                setDefaultRollouts(config.defaultRollouts || 100);
            } catch (error) {
                console.error('Failed to load configuration:', error);
            }
        }
    }, [setDatabasePath, setModelPath, setDefaultTimeout, setDefaultDepth, setDefaultRollouts]);
    
    // Save configuration to localStorage
    const saveConfiguration = React.useCallback(() => {
        const config = {
            databasePath,
            modelPath,
            defaultTimeout,
            defaultDepth,
            defaultRollouts
        };
        localStorage.setItem('azul_config', JSON.stringify(config));
        setStatusMessage('Configuration saved');
    }, [databasePath, modelPath, defaultTimeout, defaultDepth, defaultRollouts, setStatusMessage]);
    
    // Test database connection
    const testDatabaseConnection = React.useCallback(async () => {
        setConfigLoading(true);
        try {
            const response = await fetch(`${API_BASE}/health`);
            const data = await response.json();
            if (data.success) {
                setStatusMessage('Database connection successful');
            } else {
                setStatusMessage('Database connection failed');
            }
        } catch (error) {
            setStatusMessage(`Database test failed: ${error.message}`);
        } finally {
            setConfigLoading(false);
        }
    }, [setStatusMessage]);
    
    // Test model loading
    const testModelLoading = React.useCallback(async () => {
        setConfigLoading(true);
        try {
            // This would need a model test endpoint
            setStatusMessage('Model test feature coming soon...');
        } catch (error) {
            setStatusMessage(`Model test failed: ${error.message}`);
        } finally {
            setConfigLoading(false);
        }
    }, [setStatusMessage]);
    
    return React.createElement('div', {
        className: 'analysis-tools'
    },
        React.createElement('h3', {
            className: 'font-medium text-sm mb-3 flex items-center justify-between text-green-700'
        },
            React.createElement('span', null, '⚙️ Configuration'),
            React.createElement('button', {
                className: 'text-xs text-gray-500 hover:text-gray-700',
                onClick: () => setConfigExpanded(!configExpanded)
            }, configExpanded ? '−' : '+')
        ),
        
        configExpanded && React.createElement('div', {
            className: 'space-y-3'
        },
            // Database Configuration
            React.createElement('div', {
                className: 'bg-gray-50 p-3 rounded-lg border border-gray-200'
            },
                React.createElement('h4', {
                    className: 'text-sm font-medium text-gray-700 mb-2'
                }, '💾 Database Settings'),
                
                React.createElement('div', {
                    className: 'space-y-2'
                },
                    React.createElement('div', {
                        className: 'flex items-center space-x-2'
                    },
                        React.createElement('label', {
                            className: 'text-xs text-gray-600 w-20'
                        }, 'Database:'),
                        React.createElement('input', {
                            type: 'text',
                            value: databasePath,
                            onChange: (e) => setDatabasePath(e.target.value),
                            placeholder: 'azul_cache.db',
                            className: 'flex-1 text-xs border border-gray-300 rounded px-2 py-1'
                        }),
                        React.createElement('button', {
                            className: 'btn-sm btn-outline',
                            onClick: testDatabaseConnection,
                            disabled: configLoading
                        }, configLoading ? 'Testing...' : 'Test')
                    )
                )
            ),
            
            // Model Configuration
            React.createElement('div', {
                className: 'bg-gray-50 p-3 rounded-lg border border-gray-200'
            },
                React.createElement('h4', {
                    className: 'text-sm font-medium text-gray-700 mb-2'
                }, '🧠 Neural Model'),
                
                React.createElement('div', {
                    className: 'space-y-2'
                },
                    React.createElement('div', {
                        className: 'flex items-center space-x-2'
                    },
                        React.createElement('label', {
                            className: 'text-xs text-gray-600 w-20'
                        }, 'Model:'),
                        React.createElement('input', {
                            type: 'text',
                            value: modelPath,
                            onChange: (e) => setModelPath(e.target.value),
                            placeholder: 'models/azul_net_small.pth',
                            className: 'flex-1 text-xs border border-gray-300 rounded px-2 py-1'
                        }),
                        React.createElement('button', {
                            className: 'btn-sm btn-outline',
                            onClick: testModelLoading,
                            disabled: configLoading
                        }, configLoading ? 'Testing...' : 'Test')
                    )
                )
            ),
            
            // Default Settings
            React.createElement('div', {
                className: 'bg-gray-50 p-3 rounded-lg border border-gray-200'
            },
                React.createElement('h4', {
                    className: 'text-sm font-medium text-gray-700 mb-2'
                }, '⚙️ Default Settings'),
                
                React.createElement('div', {
                    className: 'space-y-2'
                },
                    // Default Timeout
                    React.createElement('div', {
                        className: 'flex items-center justify-between'
                    },
                        React.createElement('label', {
                            className: 'text-xs text-gray-600'
                        }, 'Timeout (s):'),
                        React.createElement('input', {
                            type: 'range',
                            min: '0.1',
                            max: '10.0',
                            step: '0.1',
                            value: defaultTimeout,
                            onChange: (e) => setDefaultTimeout(parseFloat(e.target.value)),
                            className: 'w-20 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer'
                        }),
                        React.createElement('span', {
                            className: 'text-xs text-gray-700 w-8 text-center'
                        }, defaultTimeout.toFixed(1))
                    ),
                    
                    // Default Depth
                    React.createElement('div', {
                        className: 'flex items-center justify-between'
                    },
                        React.createElement('label', {
                            className: 'text-xs text-gray-600'
                        }, 'Depth:'),
                        React.createElement('input', {
                            type: 'range',
                            min: '1',
                            max: '5',
                            value: defaultDepth,
                            onChange: (e) => setDefaultDepth(parseInt(e.target.value)),
                            className: 'w-20 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer'
                        }),
                        React.createElement('span', {
                            className: 'text-xs text-gray-700 w-4 text-center'
                        }, defaultDepth)
                    ),
                    
                    // Default Rollouts
                    React.createElement('div', {
                        className: 'flex items-center justify-between'
                    },
                        React.createElement('label', {
                            className: 'text-xs text-gray-600'
                        }, 'Rollouts:'),
                        React.createElement('input', {
                            type: 'range',
                            min: '10',
                            max: '1000',
                            step: '10',
                            value: defaultRollouts,
                            onChange: (e) => setDefaultRollouts(parseInt(e.target.value)),
                            className: 'w-20 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer'
                        }),
                        React.createElement('span', {
                            className: 'text-xs text-gray-700 w-12 text-center'
                        }, defaultRollouts)
                    )
                )
            ),
            
            // Save Configuration Button
            React.createElement('div', {
                className: 'flex space-x-2'
            },
                React.createElement('button', {
                    className: 'btn-sm btn-success flex-1',
                    onClick: saveConfiguration
                }, '💾 Save Config'),
                
                React.createElement('button', {
                    className: 'btn-sm btn-outline flex-1',
                    onClick: () => {
                        // Reset to defaults
                        setDatabasePath('azul_cache.db');
                        setModelPath('models/azul_net_small.pth');
                        setDefaultTimeout(4.0);
                        setDefaultDepth(3);
                        setDefaultRollouts(100);
                        setStatusMessage('Configuration reset to defaults');
                    }
                }, '🔄 Reset')
            )
        )
    );
}

function DevelopmentToolsPanel({ 
    loading, setLoading, setStatusMessage,
    devToolsExpanded, setDevToolsExpanded
}) {
    const [healthData, setHealthData] = React.useState(null);
    const [statsData, setStatsData] = React.useState(null);
    const [performanceData, setPerformanceData] = React.useState(null);
    const [systemHealthData, setSystemHealthData] = React.useState(null);
    const [optimizationResult, setOptimizationResult] = React.useState(null);
    const [analyticsData, setAnalyticsData] = React.useState(null);
    const [monitoringData, setMonitoringData] = React.useState(null);

    // System Health Check
    const checkSystemHealth = React.useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/v1/health');
            const data = await response.json();
            setHealthData(data);
            setStatusMessage('System health check completed');
        } catch (error) {
            setStatusMessage(`Health check failed: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }, [setLoading, setStatusMessage]);

    // API Statistics
    const getApiStats = React.useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/v1/stats');
            const data = await response.json();
            setStatsData(data);
            setStatusMessage('API statistics retrieved');
        } catch (error) {
            setStatusMessage(`Failed to get API stats: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }, [setLoading, setStatusMessage]);

    // Performance Statistics
    const getPerformanceStats = React.useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/v1/performance/stats');
            const data = await response.json();
            setPerformanceData(data);
            setStatusMessage('Performance statistics retrieved');
        } catch (error) {
            setStatusMessage(`Failed to get performance stats: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }, [setLoading, setStatusMessage]);

    // System Health (Detailed)
    const getSystemHealth = React.useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/v1/performance/health');
            const data = await response.json();
            setSystemHealthData(data);
            setStatusMessage('Detailed system health retrieved');
        } catch (error) {
            setStatusMessage(`Failed to get system health: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }, [setLoading, setStatusMessage]);

    // Database Optimization
    const optimizeDatabase = React.useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/v1/performance/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await response.json();
            setOptimizationResult(data);
            setStatusMessage('Database optimization completed');
        } catch (error) {
            setStatusMessage(`Database optimization failed: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }, [setLoading, setStatusMessage]);

    // Cache Analytics
    const getCacheAnalytics = React.useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/v1/performance/analytics');
            const data = await response.json();
            setAnalyticsData(data);
            setStatusMessage('Cache analytics retrieved');
        } catch (error) {
            setStatusMessage(`Failed to get cache analytics: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }, [setLoading, setStatusMessage]);

    // Monitoring Data
    const getMonitoringData = React.useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/v1/performance/monitoring');
            const data = await response.json();
            setMonitoringData(data);
            setStatusMessage('Monitoring data retrieved');
        } catch (error) {
            setStatusMessage(`Failed to get monitoring data: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }, [setLoading, setStatusMessage]);

    // Clear all data
    const clearAllData = React.useCallback(() => {
        setHealthData(null);
        setStatsData(null);
        setPerformanceData(null);
        setSystemHealthData(null);
        setOptimizationResult(null);
        setAnalyticsData(null);
        setMonitoringData(null);
        setStatusMessage('Development tools data cleared');
    }, [setStatusMessage]);

    return React.createElement('div', {
        className: 'development-tools'
    },
        React.createElement('h3', {
            className: 'font-medium text-sm mb-3 flex items-center justify-between text-purple-700'
        },
            React.createElement('span', null, '🔧 Development Tools'),
            React.createElement('button', {
                className: 'text-xs text-gray-500 hover:text-gray-700',
                onClick: () => setDevToolsExpanded(!devToolsExpanded)
            }, devToolsExpanded ? '−' : '+')
        ),
        
        devToolsExpanded && React.createElement('div', {
            className: 'space-y-3'
        },
            // System Health Check
            React.createElement('div', {
                className: 'space-y-2'
            },
                React.createElement('button', {
                    className: `w-full btn-sm ${loading ? 'btn-secondary opacity-50' : 'btn-outline'}`,
                    onClick: checkSystemHealth,
                    disabled: loading
                }, loading ? '🏥 Checking Health...' : '🏥 System Health Check'),
                
                healthData && React.createElement('div', {
                    className: 'p-2 bg-green-50 rounded text-xs'
                },
                    React.createElement('div', { className: 'font-medium' }, 'System Status:'),
                    React.createElement('div', { className: 'text-green-700' }, `Status: ${healthData.status}`),
                    React.createElement('div', { className: 'text-gray-600' }, `Version: ${healthData.version}`),
                    React.createElement('div', { className: 'text-gray-600' }, `Timestamp: ${new Date(healthData.timestamp * 1000).toLocaleString()}`)
                )
            ),

            // API Statistics
            React.createElement('div', {
                className: 'space-y-2'
            },
                React.createElement('button', {
                    className: `w-full btn-sm ${loading ? 'btn-secondary opacity-50' : 'btn-outline'}`,
                    onClick: getApiStats,
                    disabled: loading
                }, loading ? '📊 Getting Stats...' : '📊 API Statistics'),
                
                statsData && React.createElement('div', {
                    className: 'p-2 bg-blue-50 rounded text-xs'
                },
                    React.createElement('div', { className: 'font-medium' }, 'API Statistics:'),
                    React.createElement('div', { className: 'text-blue-700' }, `Rate Limits: ${JSON.stringify(statsData.rate_limits || {})}`),
                    React.createElement('div', { className: 'text-gray-600' }, `Session Stats: ${JSON.stringify(statsData.session_stats || {})}`)
                )
            ),

            // Performance Statistics
            React.createElement('div', {
                className: 'space-y-2'
            },
                React.createElement('button', {
                    className: `w-full btn-sm ${loading ? 'btn-secondary opacity-50' : 'btn-outline'}`,
                    onClick: getPerformanceStats,
                    disabled: loading
                }, loading ? '⚡ Getting Performance...' : '⚡ Performance Stats'),
                
                performanceData && React.createElement('div', {
                    className: 'p-2 bg-purple-50 rounded text-xs'
                },
                    React.createElement('div', { className: 'font-medium' }, 'Performance Statistics:'),
                    React.createElement('div', { className: 'text-purple-700' }, `Cache Hit Rate: ${performanceData.cache_analytics?.cache_hit_rate?.toFixed(2) || 'N/A'}%`),
                    React.createElement('div', { className: 'text-gray-600' }, `Positions Cached: ${performanceData.cache_analytics?.positions_cached || 0}`),
                    React.createElement('div', { className: 'text-gray-600' }, `Analyses Cached: ${performanceData.cache_analytics?.analyses_cached || 0}`),
                    React.createElement('div', { className: 'text-gray-600' }, `Cache Size: ${performanceData.cache_analytics?.total_cache_size_mb?.toFixed(2) || 0} MB`)
                )
            ),

            // System Health (Detailed)
            React.createElement('div', {
                className: 'space-y-2'
            },
                React.createElement('button', {
                    className: `w-full btn-sm ${loading ? 'btn-secondary opacity-50' : 'btn-outline'}`,
                    onClick: getSystemHealth,
                    disabled: loading
                }, loading ? '🔍 Getting Health...' : '🔍 Detailed Health'),
                
                systemHealthData && React.createElement('div', {
                    className: 'p-2 bg-orange-50 rounded text-xs'
                },
                    React.createElement('div', { className: 'font-medium' }, 'System Health:'),
                    React.createElement('div', { className: 'text-orange-700' }, `Status: ${systemHealthData.status}`),
                    systemHealthData.database && React.createElement('div', { className: 'text-gray-600' }, `Database: ${systemHealthData.database.status} (${systemHealthData.database.file_size_mb?.toFixed(2) || 0} MB)`),
                    systemHealthData.performance && React.createElement('div', { className: 'text-gray-600' }, `Performance: ${systemHealthData.performance.status} (${systemHealthData.performance.total_searches || 0} searches)`),
                    systemHealthData.cache && React.createElement('div', { className: 'text-gray-600' }, `Cache: ${systemHealthData.cache.status} (${systemHealthData.cache.total_size_mb?.toFixed(2) || 0} MB)`)
                )
            ),

            // Database Optimization
            React.createElement('div', {
                className: 'space-y-2'
            },
                React.createElement('button', {
                    className: `w-full btn-sm ${loading ? 'btn-secondary opacity-50' : 'btn-outline'}`,
                    onClick: optimizeDatabase,
                    disabled: loading
                }, loading ? '🔧 Optimizing...' : '🔧 Optimize Database'),
                
                optimizationResult && React.createElement('div', {
                    className: 'p-2 bg-yellow-50 rounded text-xs'
                },
                    React.createElement('div', { className: 'font-medium' }, 'Optimization Result:'),
                    React.createElement('div', { className: 'text-yellow-700' }, `Success: ${optimizationResult.success ? 'Yes' : 'No'}`),
                    optimizationResult.optimization_result && React.createElement('div', { className: 'text-gray-600' }, `Result: ${JSON.stringify(optimizationResult.optimization_result)}`)
                )
            ),

            // Cache Analytics
            React.createElement('div', {
                className: 'space-y-2'
            },
                React.createElement('button', {
                    className: `w-full btn-sm ${loading ? 'btn-secondary opacity-50' : 'btn-outline'}`,
                    onClick: getCacheAnalytics,
                    disabled: loading
                }, loading ? '📈 Getting Analytics...' : '📈 Cache Analytics'),
                
                analyticsData && React.createElement('div', {
                    className: 'p-2 bg-indigo-50 rounded text-xs'
                },
                    React.createElement('div', { className: 'font-medium' }, 'Cache Analytics:'),
                    React.createElement('div', { className: 'text-indigo-700' }, `Total Queries: ${analyticsData.total_queries || 0}`),
                    React.createElement('div', { className: 'text-gray-600' }, `Average Query Time: ${analyticsData.average_query_time_ms?.toFixed(2) || 0} ms`),
                    React.createElement('div', { className: 'text-gray-600' }, `Cache Efficiency: ${analyticsData.cache_efficiency?.toFixed(2) || 0}%`)
                )
            ),

            // Monitoring Data
            React.createElement('div', {
                className: 'space-y-2'
            },
                React.createElement('button', {
                    className: `w-full btn-sm ${loading ? 'btn-secondary opacity-50' : 'btn-outline'}`,
                    onClick: getMonitoringData,
                    disabled: loading
                }, loading ? '📊 Getting Monitoring...' : '📊 Monitoring Data'),
                
                monitoringData && React.createElement('div', {
                    className: 'p-2 bg-teal-50 rounded text-xs'
                },
                    React.createElement('div', { className: 'font-medium' }, 'Monitoring Data:'),
                    React.createElement('div', { className: 'text-teal-700' }, `Active Sessions: ${monitoringData.active_sessions || 0}`),
                    React.createElement('div', { className: 'text-gray-600' }, `Memory Usage: ${monitoringData.memory_usage_mb?.toFixed(2) || 0} MB`),
                    React.createElement('div', { className: 'text-gray-600' }, `CPU Usage: ${monitoringData.cpu_usage?.toFixed(2) || 0}%`)
                )
            ),

            // Clear All Data
            React.createElement('div', {
                className: 'space-y-2'
            },
                React.createElement('button', {
                    className: 'w-full btn-sm btn-outline',
                    onClick: clearAllData
                }, '🗑️ Clear All Data')
            )
        )
    );
}

// Main App Component
function App() {
    // Routing State
    const [currentPage, setCurrentPage] = React.useState('main');
    
    // State declarations
    const [sessionStatus, setSessionStatus] = React.useState('connecting');
    const [statusMessage, setStatusMessage] = React.useState('Initializing...');
    const [loading, setLoading] = React.useState(false);
    const [gameState, setGameState] = React.useState(null);
    const [selectedTile, setSelectedTile] = React.useState(null);
    const [editMode, setEditMode] = React.useState(false);
    const [selectedElements, setSelectedElements] = React.useState([]); // Array of selected elements
    const [clipboard, setClipboard] = React.useState(null); // For copy/paste
    const [editHints, setEditHints] = React.useState(true); // Show keyboard hints
    const [contextMenu, setContextMenu] = React.useState({ visible: false, x: 0, y: 0, options: [] });
    const [variations, setVariations] = React.useState([]);
    const [moveAnnotations, setMoveAnnotations] = React.useState({});
    const [moveHistory, setMoveHistory] = React.useState([]);
    const [currentPlayer, setCurrentPlayer] = React.useState(0);
    const [engineThinking, setEngineThinking] = React.useState(false);
    const [heatmapEnabled, setHeatmapEnabled] = React.useState(false);
    const [heatmapData, setHeatmapData] = React.useState(null);
    const [analysisExpanded, setAnalysisExpanded] = React.useState(true); // New state for analysis panel expansion
    const [advancedExpanded, setAdvancedExpanded] = React.useState(true); // New state for advanced tools expansion
    
    // Advanced Analysis Controls State
    const [depth, setDepth] = React.useState(3);
    const [timeBudget, setTimeBudget] = React.useState(4.0);
    const [rollouts, setRollouts] = React.useState(100);
    const [agentId, setAgentId] = React.useState(0);
    
    // Configuration Panel State
    const [databasePath, setDatabasePath] = React.useState('azul_cache.db');
    const [modelPath, setModelPath] = React.useState('models/azul_net_small.pth');
    const [defaultTimeout, setDefaultTimeout] = React.useState(4.0);
    const [defaultDepth, setDefaultDepth] = React.useState(3);
    const [defaultRollouts, setDefaultRollouts] = React.useState(100);
    const [configExpanded, setConfigExpanded] = React.useState(false);
    
    // Development Tools Panel State
    const [devToolsExpanded, setDevToolsExpanded] = React.useState(false);
    
    // Neural Training State
    const [neuralExpanded, setNeuralExpanded] = React.useState(false);
    const [trainingConfig, setTrainingConfig] = React.useState({
        modelSize: 'small',
        device: 'cpu',
        epochs: 5,
        samples: 500,
        batchSize: 16,
        learningRate: 0.001
    });
    
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
    
    // Refresh game state periodically to stay in sync (but not during edit mode)
    React.useEffect(() => {
        const interval = setInterval(() => {
            if (sessionStatus === 'connected' && !loading && !editMode) {
                getGameState().then(data => {
                    setGameState(data);
                }).catch(error => {
                    console.error('Failed to refresh game state:', error);
                });
            }
        }, 5000); // Refresh every 5 seconds
        
        return () => clearInterval(interval);
    }, [sessionStatus, loading, editMode]);
    
    // Clear selection function
    const clearSelection = React.useCallback(() => {
        setSelectedTile(null);
        setSelectedElements([]);
        setStatusMessage('Selection cleared');
    }, []);
    
    // Edit mode functions
    const handleEditModeToggle = React.useCallback(() => {
        const newEditMode = !editMode;
        setEditMode(newEditMode);
        
        if (newEditMode) {
            setStatusMessage('Edit mode enabled. Click tiles to select, use 1-5 for colors, Delete to remove.');
            setSelectedElements([]);
        } else {
            setStatusMessage('Edit mode disabled.');
            setSelectedElements([]);
            setClipboard(null);
        }
    }, [editMode]);

    // Handle element selection in edit mode
    const handleElementSelect = React.useCallback((element, isCtrlClick = false) => {
        if (!editMode) return;

        const elementId = `${element.type}_${element.data.factoryIndex || element.data.playerIndex || 0}_${element.data.rowIndex || 0}_${element.data.colIndex || element.data.tileIndex || 0}`;
        
        setSelectedElements(prev => {
            if (isCtrlClick) {
                // Multi-select with Ctrl+click
                const isAlreadySelected = prev.some(el => el.id === elementId);
                if (isAlreadySelected) {
                    return prev.filter(el => el.id !== elementId);
                } else {
                    return [...prev, { ...element, id: elementId }];
                }
            } else {
                // Single select
                return [{ ...element, id: elementId }];
            }
        });

        const count = isCtrlClick ? 'multiple' : '1';
        setStatusMessage(`Selected ${count} element(s). Use 1-5 for colors, Delete to remove, Ctrl+C/V to copy/paste.`);
    }, [editMode]);

    // Apply tile color to selected elements
    const applyTileColor = React.useCallback((colorKey) => {
        if (!editMode || selectedElements.length === 0) return;

        const colorMap = { '1': 'B', '2': 'Y', '3': 'R', '4': 'K', '5': 'W' };
        const color = colorMap[colorKey];
        
        if (!color) return;

        console.log(`Applying ${color} tiles to:`, selectedElements);
        
        // Create a deep copy of the game state to modify
        const newGameState = JSON.parse(JSON.stringify(gameState));
        
        selectedElements.forEach(element => {
            if (element.type === 'factory') {
                // Add tile to factory
                const factoryIndex = element.data.factoryIndex;
                if (newGameState.factories && newGameState.factories[factoryIndex]) {
                    newGameState.factories[factoryIndex].push(color);
                }
            } else if (element.type === 'pattern-line') {
                // Add tile to pattern line
                const { playerIndex, rowIndex } = element.data;
                if (newGameState.players && newGameState.players[playerIndex]) {
                    const player = newGameState.players[playerIndex];
                    if (player.pattern_lines && player.pattern_lines[rowIndex]) {
                        player.pattern_lines[rowIndex].push(color);
                    }
                }
            } else if (element.type === 'wall-cell') {
                // Place tile on wall
                const { playerIndex, rowIndex, colIndex } = element.data;
                if (newGameState.players && newGameState.players[playerIndex]) {
                    const player = newGameState.players[playerIndex];
                    if (player.wall && player.wall[rowIndex] && player.wall[rowIndex][colIndex] === null) {
                        player.wall[rowIndex][colIndex] = color;
                    }
                }
            }
        });
        
        // Update the game state
        setGameState(newGameState);
        setStatusMessage(`Applied ${color} tiles to ${selectedElements.length} location(s)`);
        
        // Save the updated state to the server
        saveGameState(newGameState).then(() => {
            setStatusMessage(`Applied ${color} tiles to ${selectedElements.length} location(s) - Saved to server`);
        }).catch(error => {
            console.error('Failed to save game state:', error);
            setStatusMessage(`Applied ${color} tiles but failed to save to server`);
        });
        
        // Clear selection after applying
        setSelectedElements([]);
    }, [editMode, selectedElements, gameState]);

    // Remove tiles from selected elements
    const removeSelectedTiles = React.useCallback(() => {
        if (!editMode || selectedElements.length === 0) return;

        console.log('Removing tiles from:', selectedElements);
        
        // Create a deep copy of the game state to modify
        const newGameState = JSON.parse(JSON.stringify(gameState));
        
        selectedElements.forEach(element => {
            if (element.type === 'factory') {
                // Remove all tiles from factory
                const factoryIndex = element.data.factoryIndex;
                if (newGameState.factories && newGameState.factories[factoryIndex]) {
                    newGameState.factories[factoryIndex] = [];
                }
            } else if (element.type === 'pattern-line') {
                // Remove all tiles from pattern line
                const { playerIndex, rowIndex } = element.data;
                if (newGameState.players && newGameState.players[playerIndex]) {
                    const player = newGameState.players[playerIndex];
                    if (player.pattern_lines && player.pattern_lines[rowIndex]) {
                        player.pattern_lines[rowIndex] = [];
                    }
                }
            } else if (element.type === 'wall-cell') {
                // Remove tile from wall
                const { playerIndex, rowIndex, colIndex } = element.data;
                if (newGameState.players && newGameState.players[playerIndex]) {
                    const player = newGameState.players[playerIndex];
                    if (player.wall && player.wall[rowIndex] && player.wall[rowIndex][colIndex] !== null) {
                        player.wall[rowIndex][colIndex] = null;
                    }
                }
            }
        });
        
        // Update the game state
        setGameState(newGameState);
        setStatusMessage(`Removed tiles from ${selectedElements.length} location(s)`);
        
        // Save the updated state to the server
        saveGameState(newGameState).then(() => {
            setStatusMessage(`Removed tiles from ${selectedElements.length} location(s) - Saved to server`);
        }).catch(error => {
            console.error('Failed to save game state:', error);
            setStatusMessage(`Removed tiles but failed to save to server`);
        });
        
        // Clear selection after removing
        setSelectedElements([]);
    }, [editMode, selectedElements, gameState]);

    // Copy selected elements
    const copySelection = React.useCallback(() => {
        if (!editMode || selectedElements.length === 0) return;

        setClipboard([...selectedElements]);
        setStatusMessage(`Copied ${selectedElements.length} element(s) to clipboard`);
    }, [editMode, selectedElements]);

    // Paste clipboard to selected location
    const pasteSelection = React.useCallback(() => {
        if (!editMode || !clipboard || selectedElements.length !== 1) {
            setStatusMessage('Select exactly one location to paste to');
            return;
        }

        console.log('Pasting from clipboard:', clipboard, 'to:', selectedElements[0]);
        
        // Create a deep copy of the game state to modify
        const newGameState = JSON.parse(JSON.stringify(gameState));
        const targetElement = selectedElements[0];
        
        clipboard.forEach(element => {
            if (element.type === 'factory' && targetElement.type === 'factory') {
                // Copy tiles from source factory to target factory
                const sourceFactoryIndex = element.data.factoryIndex;
                const targetFactoryIndex = targetElement.data.factoryIndex;
                
                if (newGameState.factories && newGameState.factories[sourceFactoryIndex]) {
                    const tilesToCopy = [...newGameState.factories[sourceFactoryIndex]];
                    newGameState.factories[targetFactoryIndex] = tilesToCopy;
                }
            } else if (element.type === 'pattern-line' && targetElement.type === 'pattern-line') {
                // Copy tiles from source pattern line to target pattern line
                const sourcePlayerIndex = element.data.playerIndex;
                const sourceRowIndex = element.data.rowIndex;
                const targetPlayerIndex = targetElement.data.playerIndex;
                const targetRowIndex = targetElement.data.rowIndex;
                
                if (newGameState.players && newGameState.players[sourcePlayerIndex] && newGameState.players[targetPlayerIndex]) {
                    const sourcePlayer = newGameState.players[sourcePlayerIndex];
                    const targetPlayer = newGameState.players[targetPlayerIndex];
                    
                    if (sourcePlayer.pattern_lines && sourcePlayer.pattern_lines[sourceRowIndex]) {
                        const tilesToCopy = [...sourcePlayer.pattern_lines[sourceRowIndex]];
                        targetPlayer.pattern_lines[targetRowIndex] = tilesToCopy;
                    }
                }
            }
        });
        
        // Update the game state
        setGameState(newGameState);
        setStatusMessage(`Pasted ${clipboard.length} element(s)`);
        
        // Save the updated state to the server
        saveGameState(newGameState).then(() => {
            setStatusMessage(`Pasted ${clipboard.length} element(s) - Saved to server`);
        }).catch(error => {
            console.error('Failed to save game state:', error);
            setStatusMessage(`Pasted elements but failed to save to server`);
        });
        
        setSelectedElements([]);
    }, [editMode, clipboard, selectedElements, gameState]);
    
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
    }, [showContextMenu, hideContextMenu]);
    
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
                if (editMode) {
                    setSelectedElements([]);
                    setStatusMessage('Selection cleared');
                } else {
                clearSelection();
                }
            } else if (e.key === 'e' && e.ctrlKey) {
                e.preventDefault();
                handleEditModeToggle();
            } else if (e.key === 'z' && e.ctrlKey && !editMode) {
                e.preventDefault();
                handleUndo();
            } else if (e.key === 'y' && e.ctrlKey && !editMode) {
                e.preventDefault();
                handleRedo();
            } else if (editMode) {
                // Edit mode keyboard shortcuts
                if (['1', '2', '3', '4', '5'].includes(e.key)) {
                    e.preventDefault();
                    applyTileColor(e.key);
                } else if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    removeSelectedTiles();
                } else if (e.key === 'c' && e.ctrlKey) {
                    e.preventDefault();
                    copySelection();
                } else if (e.key === 'v' && e.ctrlKey) {
                    e.preventDefault();
                    pasteSelection();
                } else if (e.key === 'a' && e.ctrlKey) {
                    e.preventDefault();
                    // Select all tiles in current view
                    setStatusMessage('Select All not implemented yet');
                }
            }
        };
        
        document.addEventListener('keydown', handleKeyPress);
        return () => document.removeEventListener('keydown', handleKeyPress);
    }, [editMode, clearSelection, handleEditModeToggle, handleUndo, handleRedo, applyTileColor, removeSelectedTiles, copySelection, pasteSelection]);
    
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
    
    return React.createElement(Router, {
        currentPage: currentPage,
        onPageChange: setCurrentPage
    },
        // Navigation
        React.createElement(Navigation, {
            currentPage: currentPage,
            onPageChange: setCurrentPage
        }),
        
        // Page Content
        currentPage === 'main' && React.createElement('div', {
            className: 'min-h-screen bg-gray-100'
        },
        // Header
        React.createElement('header', {
            className: 'bg-white shadow-sm border-b'
        },
            React.createElement('div', {
                className: 'max-w-8xl mx-auto px-6 py-4'
            },
                React.createElement('div', {
                    className: 'flex justify-between items-center'
                },
                    React.createElement('h1', {
                        className: 'text-2xl font-bold text-gray-900'
                    }, 'Azul Solver & Analysis Toolkit'),
                    React.createElement('div', {
                        className: 'flex space-x-4 xl:space-x-6'
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
            className: 'max-w-8xl mx-auto px-6 py-6'
        },
            // Status message and current player
            React.createElement('div', {
                className: 'mb-6 space-y-2'
            },
            React.createElement(StatusMessage, {
                type: sessionStatus === 'connected' ? 'success' : 'error',
                message: statusMessage
            }),
                React.createElement('div', {
                    className: 'flex justify-between items-center p-4 bg-blue-50 rounded-lg'
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
            
            // Game board and player boards - Enhanced layout for larger screens
            React.createElement('div', {
                className: 'grid grid-cols-1 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6'
            },
                // Game boards (factories + player boards) - takes more columns on larger screens
                React.createElement('div', {
                    className: 'lg:col-span-3 xl:col-span-4 2xl:col-span-5 space-y-6'
                },
                    // Factories
                    React.createElement('div', null,
                    React.createElement('h2', {
                        className: 'text-xl font-semibold mb-4'
                    }, 'Factories'),
                    React.createElement('div', {
                        className: 'grid grid-cols-5 md:grid-cols-5 lg:grid-cols-5 xl:grid-cols-5 2xl:grid-cols-5 gap-4 xl:gap-6'
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
                                    selectedElements: selectedElements,
                                    heatmapEnabled: heatmapEnabled,
                                    heatmapData: heatmapData
                            })
                        )
                    )
                ),
                
                    // Player boards - side by side layout
                    React.createElement('div', null,
                        React.createElement('h2', {
                            className: 'text-xl font-semibold mb-3'
                        }, 'Player Boards'),
                        React.createElement('div', {
                            className: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-2 gap-4 xl:gap-6'
                        },
                            (gameState.players || []).map((player, index) => 
                                React.createElement(PlayerBoard, {
                                    key: index,
                                    player: player,
                                    playerIndex: index,
                                    isActive: index === currentPlayer,
                                    editMode: editMode,
                                    onElementSelect: handleElementSelect,
                                    selectedElements: selectedElements,
                                    onPatternLineDrop: handlePatternLineDrop,
                                    onPlayerSwitch: (playerId) => setCurrentPlayer(playerId),
                                    canInteract: !loading && !engineThinking
                                })
                            )
                        )
                    )
                ),
                
                // Analysis panel - takes 1 column on the right, but more space on larger screens
                React.createElement('div', {
                    className: 'lg:col-span-1 xl:col-span-1 2xl:col-span-1 analysis-panel'
                },
                    React.createElement('h2', {
                        className: 'analysis-title'
                    }, '🔍 Analysis & Controls'),
                    React.createElement('div', {
                        className: 'space-y-3'
                    },
                        // Action buttons - compact
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
                        
                        // Analysis Tools - Organized with better labels
                        React.createElement('div', {
                            className: 'analysis-tools'
                        },
                            React.createElement('h3', {
                                className: 'font-medium text-sm mb-3 flex items-center justify-between text-blue-700'
                            },
                                React.createElement('span', null, '🔍 Position Analysis'),
                                React.createElement('button', {
                                    className: 'text-xs text-gray-500 hover:text-gray-700',
                                    onClick: () => setAnalysisExpanded(!analysisExpanded)
                                }, analysisExpanded ? '−' : '+')
                            ),
                            
                            // Collapsible analysis content
                            analysisExpanded && React.createElement('div', {
                                className: 'space-y-3'
                            },
                                                            // Advanced Analysis Controls
                            React.createElement(AdvancedAnalysisControls, {
                                loading: loading,
                                setLoading: setLoading,
                                analyzePosition: analyzePosition,
                                getHint: getHint,
                                analyzeNeural: analyzeNeural,
                                gameState: gameState,
                                setVariations: setVariations,
                                setHeatmapData: setHeatmapData,
                                setStatusMessage: setStatusMessage,
                                moveHistory: moveHistory,
                                analyzeGame: analyzeGame,
                                depth: depth,
                                setDepth: setDepth,
                                timeBudget: timeBudget,
                                setTimeBudget: setTimeBudget,
                                rollouts: rollouts,
                                setRollouts: setRollouts,
                                agentId: agentId,
                                setAgentId: setAgentId
                            }),
                            
                            // Advanced Analysis Settings Panel
                            React.createElement('div', {
                                className: 'bg-gray-50 p-3 rounded-lg border border-gray-200'
                            },
                                React.createElement('h4', {
                                    className: 'text-sm font-medium text-gray-700 mb-3'
                                }, '⚙️ Analysis Settings'),
                                
                                React.createElement('div', {
                                    className: 'space-y-3'
                                },
                                    // Depth control
                                    React.createElement('div', {
                                        className: 'flex items-center justify-between'
                                    },
                                        React.createElement('label', {
                                            className: 'text-xs text-gray-600'
                                        }, 'Depth:'),
                                        React.createElement('input', {
                                            type: 'range',
                                            min: '1',
                                            max: '5',
                                            value: depth,
                                            onChange: (e) => setDepth(parseInt(e.target.value)),
                                            className: 'w-20 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer'
                                        }),
                                        React.createElement('span', {
                                            className: 'text-xs text-gray-700 w-4 text-center'
                                        }, depth)
                                    ),
                                    
                                    // Time budget control
                                    React.createElement('div', {
                                        className: 'flex items-center justify-between'
                                    },
                                        React.createElement('label', {
                                            className: 'text-xs text-gray-600'
                                        }, 'Time (s):'),
                                        React.createElement('input', {
                                            type: 'range',
                                            min: '0.1',
                                            max: '10.0',
                                            step: '0.1',
                                            value: timeBudget,
                                            onChange: (e) => setTimeBudget(parseFloat(e.target.value)),
                                            className: 'w-20 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer'
                                        }),
                                        React.createElement('span', {
                                            className: 'text-xs text-gray-700 w-8 text-center'
                                        }, timeBudget.toFixed(1))
                                    ),
                                    
                                    // Rollouts control
                                    React.createElement('div', {
                                        className: 'flex items-center justify-between'
                                    },
                                        React.createElement('label', {
                                            className: 'text-xs text-gray-600'
                                        }, 'Rollouts:'),
                                        React.createElement('input', {
                                            type: 'range',
                                            min: '10',
                                            max: '1000',
                                            step: '10',
                                            value: rollouts,
                                            onChange: (e) => setRollouts(parseInt(e.target.value)),
                                            className: 'w-20 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer'
                                        }),
                                        React.createElement('span', {
                                            className: 'text-xs text-gray-700 w-12 text-center'
                                        }, rollouts)
                                    ),
                                    
                                    // Agent selection
                                    React.createElement('div', {
                                        className: 'flex items-center justify-between'
                                    },
                                        React.createElement('label', {
                                            className: 'text-xs text-gray-600'
                                        }, 'Agent:'),
                                        React.createElement('select', {
                                            value: agentId,
                                            onChange: (e) => setAgentId(parseInt(e.target.value)),
                                            className: 'text-xs border border-gray-300 rounded px-2 py-1'
                                        },
                                            React.createElement('option', { value: 0 }, 'Player 1'),
                                            React.createElement('option', { value: 1 }, 'Player 2')
                                        )
                                    )
                                )
                            ),
                            
                            // Heatmap toggle
                            React.createElement('div', {
                                className: 'flex items-center space-x-2'
                            },
                                React.createElement('button', {
                                    className: `btn-sm flex-1 ${heatmapEnabled ? 'btn-success' : 'btn-secondary'}`,
                                    onClick: () => {
                                        setHeatmapEnabled(!heatmapEnabled);
                                        setStatusMessage(heatmapEnabled ? 'Heatmap disabled' : 'Heatmap enabled');
                                    },
                                    disabled: !heatmapData
                                }, heatmapEnabled ? '🔥 Heatmap ON' : '🔥 Heatmap OFF')
                            ),
                                
                                // Analysis results display
                                variations.length > 0 && React.createElement('div', {
                                    className: 'bg-gradient-to-r from-blue-50 to-purple-50 p-3 rounded-lg border border-blue-200'
                                },
                                    React.createElement('div', { 
                                        className: 'font-semibold mb-2 text-blue-800 text-sm' 
                                    }, '📊 Analysis Results'),
                                    React.createElement('div', { 
                                        className: 'text-xs space-y-1' 
                                    },
                                        React.createElement('div', { 
                                            className: 'font-medium text-blue-700' 
                                        }, 'Best Move:'),
                                        React.createElement('div', { 
                                            className: 'bg-white p-2 rounded border' 
                                        }, `${variations[0].move} (${variations[0].score.toFixed(2)})`),
                                        variations[0].visits && React.createElement('div', { 
                                            className: 'text-gray-600 mt-1' 
                                        }, `Nodes searched: ${variations[0].visits}`)
                                    )
                                )
                            )
                        ),
                        
                        // Configuration Panel
                        React.createElement(ConfigurationPanel, {
                            loading: loading,
                            setLoading: setLoading,
                            setStatusMessage: setStatusMessage,
                            databasePath: databasePath,
                            setDatabasePath: setDatabasePath,
                            modelPath: modelPath,
                            setModelPath: setModelPath,
                            defaultTimeout: defaultTimeout,
                            setDefaultTimeout: setDefaultTimeout,
                            defaultDepth: defaultDepth,
                            setDefaultDepth: setDefaultDepth,
                            defaultRollouts: defaultRollouts,
                            setDefaultRollouts: setDefaultRollouts,
                            configExpanded: configExpanded,
                            setConfigExpanded: setConfigExpanded
                        }),
                        
                        // Development Tools Panel
                        React.createElement(DevelopmentToolsPanel, {
                            loading: loading,
                            setLoading: setLoading,
                            setStatusMessage: setStatusMessage,
                            devToolsExpanded: devToolsExpanded,
                            setDevToolsExpanded: setDevToolsExpanded
                        }),
                        
                        // Advanced Tools - Organized with better labels
                        React.createElement('div', {
                            className: 'analysis-tools'
                        },
                            React.createElement('h3', {
                                className: 'font-medium text-sm mb-3 flex items-center justify-between text-purple-700'
                            },
                                React.createElement('span', null, '🛠️ Advanced Tools'),
                                React.createElement('button', {
                                    className: 'text-xs text-gray-500 hover:text-gray-700',
                                    onClick: () => setAdvancedExpanded(!advancedExpanded)
                                }, advancedExpanded ? '−' : '+')
                            ),
                            
                            advancedExpanded && React.createElement('div', {
                                className: 'space-y-3'
                            },
                                React.createElement('div', {
                                    className: 'space-y-2'
                                },
                                    React.createElement('button', {
                                        className: `w-full btn-sm ${loading ? 'btn-secondary opacity-50' : 'btn-outline'}`,
                                        onClick: () => {
                                            setLoading(true);
                                            const gameData = {
                                                moves: moveHistory.map((move, index) => ({
                                                    move: move,
                                                    player: index % 2,
                                                    position_before: 'initial'
                                                })),
                                                players: ['Player 1', 'Player 2'],
                                                result: { winner: null, score: [0, 0] }
                                            };
                                            
                                            analyzeGame(gameData, 3)
                                                .then(data => {
                                                    if (data.success) {
                                                        const blunderCount = data.summary.blunder_count;
                                                        setStatusMessage(`Game analysis complete: ${blunderCount} blunders found`);
                                                    } else {
                                                        setStatusMessage('Game analysis failed');
                                                    }
                                                })
                                                .catch(error => {
                                                    setStatusMessage(`Game analysis failed: ${error.message}`);
                                                })
                                                .finally(() => setLoading(false));
                                        },
                                        disabled: loading || moveHistory.length === 0
                                    }, loading ? '📊 Analyzing Game...' : '📊 Analyze Full Game'),
                                    
                                    React.createElement('div', {
                                        className: 'grid grid-cols-2 gap-2'
                                    },
                                        React.createElement('button', {
                                            className: 'w-full btn-sm btn-outline',
                                            onClick: () => {
                                                setStatusMessage('Position database feature coming soon...');
                                            },
                                            disabled: loading
                                        }, '💾 Save Position'),
                                        
                                        React.createElement('button', {
                                            className: 'w-full btn-sm btn-outline',
                                            onClick: () => {
                                                setStatusMessage('Similar positions feature coming soon...');
                                            },
                                            disabled: loading
                                        }, '🔍 Find Similar')
                                    )
                                )
                            )
                        ),
                        
                        // Edit Mode Keyboard Hints - only show when edit mode is active
                        editMode && editHints && React.createElement('div', {
                            className: 'keyboard-hints mt-3 p-3 bg-orange-50 rounded text-xs'
                        },
            React.createElement('div', {
                                className: 'flex justify-between items-center mb-2'
                            },
                                React.createElement('h3', {
                                    className: 'font-medium'
                                }, '⌨️ Shortcuts'),
                                React.createElement('button', {
                                    className: 'text-xs text-gray-500 hover:text-gray-700',
                                    onClick: () => setEditHints(false)
                                }, '✕')
                            ),
                            React.createElement('div', {
                                className: 'grid grid-cols-2 gap-2 text-xs'
                            },
                                React.createElement('div', null,
                                    React.createElement('div', { className: 'font-medium' }, 'Selection:'),
                                    React.createElement('div', null, 'Click - Select'),
                                    React.createElement('div', null, 'Ctrl+Click - Multi-select'),
                                    React.createElement('div', null, 'Esc - Clear selection')
                                ),
                                React.createElement('div', null,
                                    React.createElement('div', { className: 'font-medium' }, 'Actions:'),
                                    React.createElement('div', null, '1-5 - Add tile colors'),
                                    React.createElement('div', null, 'Del - Remove tiles'),
                                    React.createElement('div', null, 'Ctrl+C/V - Copy/Paste')
                                )
                            ),
                            React.createElement('div', {
                                className: 'mt-2 p-1 bg-orange-100 rounded text-xs'
                            },
                                React.createElement('strong', null, 'Colors: '),
                                '1=Blue, 2=Yellow, 3=Red, 4=Black, 5=White'
                            ),
                            selectedElements.length > 0 && React.createElement('div', {
                                className: 'mt-2 p-1 bg-blue-100 rounded text-xs'
                            },
                                React.createElement('strong', null, `${selectedElements.length} element(s) selected`)
                            )
                        ),
                        
                        // Move history - compact
                        moveHistory.length > 0 && React.createElement('div', {
                            className: 'mt-3'
                        },
                            React.createElement('h3', {
                                className: 'font-medium text-sm mb-2'
                            }, '📜 Move History'),
                            React.createElement('div', {
                                className: 'max-h-24 overflow-y-auto space-y-1'
                            },
                                moveHistory.slice(-3).map((historyItem, index) => 
                                    React.createElement('div', {
                        key: index,
                                        className: 'text-xs p-1 bg-gray-100 rounded'
                                    },
                                        React.createElement('div', {
                                            className: 'font-medium'
                                        }, `P${historyItem.player + 1}`),
                                        React.createElement('div', null, historyItem.result.move_executed || 'Move executed')
                                    )
                                )
                            )
                        )
                    )
                )
            ),
            
            // Debug panel
            React.createElement('div', {
                className: 'mt-3 p-3 bg-gray-50 rounded-lg'
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
            selectedElements.length > 0 && React.createElement('div', {
                className: 'mt-3 p-3 bg-blue-50 rounded-lg'
            },
                React.createElement('h3', {
                    className: 'font-semibold mb-2'
                }, `Selected Elements (${selectedElements.length})`),
                selectedElements.map((element, index) => 
                    React.createElement('div', {
                        key: index,
                        className: 'mb-2 p-2 bg-blue-100 rounded'
                    },
                        React.createElement('strong', null, `${element.type}: `),
                        formatSelectedElement(element)
                    )
                )
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
        ),
        
        // Neural Training Page
        currentPage === 'neural' && React.createElement(NeuralTrainingPage, {
            loading: loading,
            setLoading: setLoading,
            setStatusMessage: setStatusMessage,
            trainingConfig: trainingConfig,
            setTrainingConfig: setTrainingConfig,
            neuralExpanded: neuralExpanded,
            setNeuralExpanded: setNeuralExpanded
        })
    );
}

// Neural Training Components
function TrainingConfigPanel({ 
    loading, setLoading, setStatusMessage,
    trainingConfig, setTrainingConfig,
    neuralExpanded, setNeuralExpanded
}) {
    // Training configuration state
    const [modelSize, setModelSize] = React.useState('small');
    const [device, setDevice] = React.useState('cpu');
    const [epochs, setEpochs] = React.useState(5);
    const [samples, setSamples] = React.useState(500);
    const [batchSize, setBatchSize] = React.useState(16);
    const [learningRate, setLearningRate] = React.useState(0.001);
    const [availableDevices, setAvailableDevices] = React.useState(['cpu']);

    // Load available devices on component mount
    React.useEffect(() => {
        // For now, we'll assume CPU is always available
        // In a real implementation, this would check for CUDA availability
        setAvailableDevices(['cpu']);
    }, []);

    // Start training function
    const handleStartTraining = React.useCallback(async () => {
        setLoading(true);
        try {
            const config = {
                modelSize,
                device,
                epochs,
                samples,
                batchSize,
                learningRate
            };
            
            const response = await startNeuralTraining(config);
            if (response.success) {
                setStatusMessage('Neural training started successfully');
                // Store the session ID for monitoring
                if (response.session_id) {
                    localStorage.setItem('neural_training_session', response.session_id);
                }
            } else {
                setStatusMessage(`Training failed: ${response.error || 'Unknown error'}`);
            }
        } catch (error) {
            setStatusMessage(`Training failed: ${error.message}`);
        } finally {
            setLoading(false);
        }
    }, [modelSize, device, epochs, samples, batchSize, learningRate, setLoading, setStatusMessage]);

    // Save configuration
    const handleSaveConfig = React.useCallback(async () => {
        try {
            const config = {
                modelSize,
                device,
                epochs,
                samples,
                batchSize,
                learningRate
            };
            
            await saveNeuralConfig(config);
            setStatusMessage('Training configuration saved');
        } catch (error) {
            setStatusMessage(`Failed to save config: ${error.message}`);
        }
    }, [modelSize, device, epochs, samples, batchSize, learningRate, setStatusMessage]);

    return React.createElement('div', {
        className: 'neural-training-config'
    },
        React.createElement('h3', {
            className: 'font-medium text-sm mb-3 flex items-center justify-between text-purple-700'
        },
            React.createElement('span', null, '🧠 Neural Training'),
            React.createElement('button', {
                className: 'text-xs text-gray-500 hover:text-gray-700',
                onClick: () => setNeuralExpanded(!neuralExpanded)
            }, neuralExpanded ? '−' : '+')
        ),
        
        // Collapsible neural training content
        neuralExpanded && React.createElement('div', {
            className: 'space-y-3'
        },
            // Model Configuration
            React.createElement('div', {
                className: 'space-y-2'
            },
                React.createElement('label', {
                    className: 'block text-xs font-medium text-gray-700'
                }, 'Model Size'),
                React.createElement('select', {
                    className: 'w-full text-sm border border-gray-300 rounded px-2 py-1',
                    value: modelSize,
                    onChange: (e) => setModelSize(e.target.value)
                },
                    React.createElement('option', { value: 'small' }, 'Small (64 hidden, 2 layers)'),
                    React.createElement('option', { value: 'medium' }, 'Medium (128 hidden, 3 layers)'),
                    React.createElement('option', { value: 'large' }, 'Large (256 hidden, 4 layers)')
                )
            ),
            
            // Device Selection
            React.createElement('div', {
                className: 'space-y-2'
            },
                React.createElement('label', {
                    className: 'block text-xs font-medium text-gray-700'
                }, 'Device'),
                React.createElement('div', {
                    className: 'flex space-x-2'
                },
                    availableDevices.map(dev => 
                        React.createElement('label', {
                            key: dev,
                            className: 'flex items-center space-x-1'
                        },
                            React.createElement('input', {
                                type: 'radio',
                                name: 'device',
                                value: dev,
                                checked: device === dev,
                                onChange: (e) => setDevice(e.target.value),
                                className: 'text-purple-600'
                            }),
                            React.createElement('span', {
                                className: 'text-xs'
                            }, dev.toUpperCase())
                        )
                    )
                )
            ),
            
            // Training Parameters
            React.createElement('div', {
                className: 'space-y-2'
            },
                React.createElement('label', {
                    className: 'block text-xs font-medium text-gray-700'
                }, 'Epochs (1-100)'),
                React.createElement('input', {
                    type: 'range',
                    min: '1',
                    max: '100',
                    value: epochs,
                    onChange: (e) => setEpochs(parseInt(e.target.value)),
                    className: 'w-full'
                }),
                React.createElement('div', {
                    className: 'text-xs text-gray-500'
                }, `${epochs} epochs`)
            ),
            
            React.createElement('div', {
                className: 'space-y-2'
            },
                React.createElement('label', {
                    className: 'block text-xs font-medium text-gray-700'
                }, 'Samples (100-10000)'),
                React.createElement('input', {
                    type: 'range',
                    min: '100',
                    max: '10000',
                    step: '100',
                    value: samples,
                    onChange: (e) => setSamples(parseInt(e.target.value)),
                    className: 'w-full'
                }),
                React.createElement('div', {
                    className: 'text-xs text-gray-500'
                }, `${samples.toLocaleString()} samples`)
            ),
            
            React.createElement('div', {
                className: 'space-y-2'
            },
                React.createElement('label', {
                    className: 'block text-xs font-medium text-gray-700'
                }, 'Batch Size (8-64)'),
                React.createElement('input', {
                    type: 'range',
                    min: '8',
                    max: '64',
                    step: '8',
                    value: batchSize,
                    onChange: (e) => setBatchSize(parseInt(e.target.value)),
                    className: 'w-full'
                }),
                React.createElement('div', {
                    className: 'text-xs text-gray-500'
                }, `${batchSize} batch size`)
            ),
            
            React.createElement('div', {
                className: 'space-y-2'
            },
                React.createElement('label', {
                    className: 'block text-xs font-medium text-gray-700'
                }, 'Learning Rate (0.0001-0.01)'),
                React.createElement('input', {
                    type: 'range',
                    min: '0.0001',
                    max: '0.01',
                    step: '0.0001',
                    value: learningRate,
                    onChange: (e) => setLearningRate(parseFloat(e.target.value)),
                    className: 'w-full'
                }),
                React.createElement('div', {
                    className: 'text-xs text-gray-500'
                }, `${learningRate.toFixed(4)} learning rate`)
            ),
            
            // Action Buttons
            React.createElement('div', {
                className: 'grid grid-cols-2 gap-2'
            },
                React.createElement('button', {
                    className: `w-full btn-sm ${loading ? 'btn-secondary opacity-50' : 'btn-success'}`,
                    onClick: handleStartTraining,
                    disabled: loading
                }, loading ? '🚀 Starting...' : '🚀 Start Training'),
                
                React.createElement('button', {
                    className: 'w-full btn-sm btn-outline',
                    onClick: handleSaveConfig
                }, '💾 Save Config')
            )
        )
    );
}

// Render the app
const root = createRoot(document.getElementById('root'));
root.render(React.createElement(App));