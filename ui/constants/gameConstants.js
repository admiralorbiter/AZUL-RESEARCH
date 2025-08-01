// Game Constants and Configuration

// Tile types
export const TILE_TYPES = {
    RED: 'R',
    YELLOW: 'Y',
    BLUE: 'B',
    WHITE: 'W',
    BLACK: 'K',
    EMPTY: 'W'
};

// Tile colors mapping
export const TILE_COLORS = {
    'R': '#ef4444', // Red
    'Y': '#eab308', // Yellow
    'B': '#3b82f6', // Blue
    'W': '#ffffff', // White
    'K': '#000000', // Black
    'W': '#f3f4f6'  // White (empty)
};

// Game modes
export const GAME_MODES = {
    SANDBOX: 'sandbox',
    ANALYSIS: 'analysis',
    SETUP: 'setup'
};

// Element types for editing
export const ELEMENT_TYPES = {
    FACTORY: 'factory',
    FACTORY_TILE: 'factory-tile',
    PATTERN_LINE: 'pattern-line',
    PATTERN_LINE_TILE: 'pattern-line-tile',
    PATTERN_LINE_EMPTY: 'pattern-line-empty',
    WALL_CELL: 'wall-cell',
    FLOOR_TILE: 'floor-tile',
    FLOOR_EMPTY: 'floor-empty'
};

// Context menu actions
export const CONTEXT_MENU_ACTIONS = {
    EDIT_TILES: 'Edit Tiles',
    CLEAR_FACTORY: 'Clear Factory',
    ADD_TILE: 'Add Tile',
    REMOVE_TILE: 'Remove Tile',
    CHANGE_COLOR: 'Change Color',
    MOVE_TILE: 'Move Tile',
    TOGGLE_TILE: 'Toggle Tile',
    CLEAR_LINE: 'Clear Line'
};

// Status message types
export const STATUS_TYPES = {
    SUCCESS: 'success',
    ERROR: 'error',
    WARNING: 'warning',
    INFO: 'info'
};

// Default game configuration
export const DEFAULT_GAME_CONFIG = {
    playerCount: 2,
    currentPlayer: 0,
    autoAdvanceTurn: false,
    gameMode: GAME_MODES.SANDBOX
};

// API endpoints
export const API_ENDPOINTS = {
    SESSION: '/api/v1/auth/session',
    ANALYZE: '/api/v1/analyze',
    HINT: '/api/v1/hint',
    HEALTH: '/api/v1/health',
    STATS: '/api/v1/stats'
};

// Drag and drop configuration
export const DRAG_CONFIG = {
    GHOST_OPACITY: 0.8,
    GHOST_ROTATION: 5,
    GHOST_SIZE: 40
};

// Visual feedback configuration
export const VISUAL_CONFIG = {
    HOVER_SCALE: 1.1,
    SELECTED_SCALE: 1.15,
    TRANSITION_DURATION: '0.2s',
    HIGHLIGHT_COLOR: '#f59e0b',
    SUCCESS_COLOR: '#10b981',
    ERROR_COLOR: '#ef4444',
    INFO_COLOR: '#3b82f6'
}; 