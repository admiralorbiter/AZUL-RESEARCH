"""
REST API routes for the Azul Solver & Analysis Toolkit.

This module provides Flask blueprints for game analysis, hints, and research tools.
"""

import json
import time
import copy
import random
import threading
import uuid
import psutil
import os
from datetime import datetime
from typing import Dict, Any, Optional, List
from flask import Blueprint, request, jsonify, current_app
from pydantic import BaseModel, ValidationError, ConfigDict
from dataclasses import asdict

from .auth import require_session
from .rate_limiter import RateLimiter
from core.azul_database import AzulDatabase

# Initialize database connection
db = AzulDatabase()


class AnalysisRequest(BaseModel):
    """Request model for analysis endpoints."""
    fen_string: str
    agent_id: int = 0
    depth: Optional[int] = None
    time_budget: Optional[float] = None
    rollouts: Optional[int] = None


class HintRequest(BaseModel):
    """Request model for hint endpoints."""
    fen_string: str
    agent_id: int = 0
    budget: float = 0.2
    rollouts: int = 100


class PositionCacheRequest(BaseModel):
    """Request model for position cache endpoints."""
    model_config = ConfigDict(extra="forbid")
    
    fen_string: str
    player_count: int = 2
    compressed_state: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class BulkPositionRequest(BaseModel):
    """Request model for bulk position operations."""
    positions: list[PositionCacheRequest]
    overwrite: bool = False


class AnalysisCacheRequest(BaseModel):
    """Request model for analysis cache endpoints."""
    fen_string: str
    agent_id: int = 0
    search_type: str  # 'mcts', 'alpha_beta', 'neural_mcts'
    best_move: Optional[str] = None
    best_score: float = 0.0
    search_time: float = 0.0
    nodes_searched: int = 0
    rollout_count: int = 0
    depth_reached: Optional[int] = None
    principal_variation: Optional[list[str]] = None
    metadata: Optional[Dict[str, Any]] = None


class AnalysisSearchRequest(BaseModel):
    """Request model for analysis search."""
    search_type: Optional[str] = None
    agent_id: Optional[int] = None
    min_score: Optional[float] = None
    max_score: Optional[float] = None
    limit: int = 50
    offset: int = 0


class PerformanceStatsRequest(BaseModel):
    """Request model for performance statistics."""
    search_type: Optional[str] = None
    time_range_hours: Optional[int] = None
    include_query_stats: bool = True
    include_index_stats: bool = True


class SystemHealthRequest(BaseModel):
    """Request model for system health checks."""
    include_database_health: bool = True
    include_performance_metrics: bool = True
    include_cache_analytics: bool = True


class MoveExecutionRequest(BaseModel):
    """Request model for move execution."""
    fen_string: str
    move: Dict[str, Any]  # Move data from frontend
    agent_id: int = 0


class GameCreationRequest(BaseModel):
    """Request model for game creation."""
    player_count: int = 2  # Only 2-player games supported
    seed: Optional[int] = None


# Add these new request models after the existing ones (around line 100)

class GameAnalysisRequest(BaseModel):
    """Request model for game analysis."""
    game_data: Dict[str, Any]  # Game log data
    include_blunder_analysis: bool = True
    include_position_analysis: bool = True
    analysis_depth: int = 3


class GameLogUploadRequest(BaseModel):
    """Request model for game log upload."""
    game_format: str = 'json'  # 'json', 'text', 'pgn'
    game_content: str
    game_metadata: Optional[Dict[str, Any]] = None


class GameAnalysisSearchRequest(BaseModel):
    """Request model for searching game analyses."""
    player_names: Optional[List[str]] = None
    min_blunder_count: Optional[int] = None
    max_blunder_count: Optional[int] = None
    date_range: Optional[Dict[str, str]] = None
    limit: int = 50
    offset: int = 0


class PositionDatabaseRequest(BaseModel):
    """Request model for position database operations."""
    fen_string: str
    metadata: Optional[Dict[str, Any]] = None
    frequency: int = 1


class SimilarPositionRequest(BaseModel):
    """Request model for finding similar positions."""
    fen_string: str
    similarity_threshold: float = 0.8
    limit: int = 10


class ContinuationRequest(BaseModel):
    """Request model for getting popular continuations."""
    fen_string: str
    limit: int = 5


# Create Flask blueprint for API endpoints
api_bp = Blueprint('api', __name__, url_prefix='/api/v1')


# Global variable to store the current game state
_current_game_state = None
_initial_game_state = None  # Store the original initial state
_current_editable_game_state = None  # Store the current editable game state from frontend

# Global training sessions storage (now database-backed)
# training_sessions = {}  # Replaced with database storage

# Global evaluation sessions storage
evaluation_sessions = {}

# The TrainingSession class has been removed - we now use database-backed NeuralTrainingSession only

def parse_fen_string(fen_string: str):
    """Parse FEN string to create game state."""
    global _current_game_state, _initial_game_state
    from core.azul_model import AzulState
    
    if fen_string.lower() == "initial":
        # Use a consistent initial state with fixed seed for reproducibility
        if _initial_game_state is None:
            # Set a fixed seed to ensure consistent initial state
            random.seed(42)
            _initial_game_state = AzulState(2)  # 2-player starting position
            # Reset seed to random
            random.seed()
            # Initialize current state from initial state
            _current_game_state = copy.deepcopy(_initial_game_state)
        
        # Always return the current game state (which starts as a copy of initial)
        return _current_game_state
    elif fen_string.startswith("state_"):
        # This is a state identifier - return the current game state
        if _current_game_state is None:
            # If we don't have a current state, create from initial state
            if _initial_game_state is None:
                random.seed(42)
                _initial_game_state = AzulState(2)
                random.seed()
            _current_game_state = copy.deepcopy(_initial_game_state)
        return _current_game_state
    else:
        raise ValueError(f"Unsupported FEN format: {fen_string}. Use 'initial' or state identifiers.")

def update_current_game_state(new_state):
    """Update the current game state."""
    global _current_game_state
    _current_game_state = new_state


def format_move(move):
    """Format a move for display."""
    if move is None:
        return "None"
    
    try:
        # Convert tile type to color name
        tile_colors = {0: 'blue', 1: 'yellow', 2: 'red', 3: 'black', 4: 'white'}
        tile_color = tile_colors.get(move.tile_type, f'tile_{move.tile_type}')
        
        # Format as string for tests
        if move.action_type == 1:  # Factory move
            return f"take_from_factory_{move.source_id}_{tile_color}_{move.pattern_line_dest}_{move.num_to_pattern_line}_{move.num_to_floor_line}"
        else:  # Center move
            return f"take_from_center_{move.source_id}_{tile_color}_{move.pattern_line_dest}_{move.num_to_pattern_line}_{move.num_to_floor_line}"
    except Exception as e:
        # Fallback if move formatting fails
        return f"move_{getattr(move, 'source_id', '?')}_{getattr(move, 'tile_type', '?')}"


# Position Cache API Endpoints

@api_bp.route('/positions/<path:fen_string>', methods=['GET'])
@require_session
def get_position(fen_string: str):
    """
    Get position data from cache.
    
    GET /api/v1/positions/{fen_string}
    
    Returns:
        Position data including ID, player count, and metadata
    """
    try:
        # Check if database is available
        if not current_app.database:
            return jsonify({
                'error': 'Database not available',
                'message': 'Position cache is disabled'
            }), 503
        
        # Get position ID
        position_id = current_app.database.get_position_id(fen_string)
        if position_id is None:
            return jsonify({
                'error': 'Position not found',
                'message': f'Position {fen_string} not in cache'
            }), 404
        
        # Get position details
        with current_app.database.get_connection() as conn:
            cursor = conn.execute("""
                SELECT id, fen_string, player_count, created_at, 
                       compressed_state IS NOT NULL as has_compressed_state
                FROM positions 
                WHERE fen_string = ?
            """, (fen_string,))
            
            row = cursor.fetchone()
            if not row:
                return jsonify({
                    'error': 'Position not found',
                    'message': f'Position {fen_string} not in cache'
                }), 404
            
            # Get analysis count for this position
            cursor = conn.execute("""
                SELECT COUNT(*) as analysis_count
                FROM analysis_results 
                WHERE position_id = ?
            """, (position_id,))
            
            analysis_count = cursor.fetchone()['analysis_count']
            
            return jsonify({
                'position_id': row['id'],
                'fen_string': row['fen_string'],
                'player_count': row['player_count'],
                'created_at': row['created_at'],
                'has_compressed_state': bool(row['has_compressed_state']),
                'analysis_count': analysis_count,
                'cache_hit': True
            })
            
    except Exception as e:
        current_app.logger.error(f"Error getting position {fen_string}: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': 'Failed to retrieve position data'
        }), 500


@api_bp.route('/positions/<path:fen_string>', methods=['PUT'])
@require_session
def put_position(fen_string: str):
    """
    Store position data in cache.
    
    PUT /api/v1/positions/{fen_string}
    {
        "player_count": 2,
        "compressed_state": "optional_compressed_data",
        "metadata": {"source": "game_log", "tags": ["opening"]}
    }
    
    Returns:
        Position ID and cache status
    """
    try:
        # Check if database is available
        if not current_app.database:
            return jsonify({
                'error': 'Database not available',
                'message': 'Position cache is disabled'
            }), 503
        
        # Parse request data
        try:
            data = request.get_json(force=True)
        except Exception:
            data = None
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        # Validate request
        try:
            cache_req = PositionCacheRequest(fen_string=fen_string, **data)
        except ValidationError as e:
            return jsonify({
                'error': 'Validation error',
                'message': str(e)
            }), 400
        
        # Store position in cache
        if cache_req.compressed_state:
            position_id = current_app.database.cache_position_with_state(
                fen_string, cache_req.player_count, cache_req.compressed_state
            )
        else:
            position_id = current_app.database.cache_position(
                fen_string, cache_req.player_count
            )
        
        # Store metadata if provided
        if cache_req.metadata:
            with current_app.database.get_connection() as conn:
                # Note: This would require adding a metadata column to positions table
                # For now, we'll just log the metadata
                current_app.logger.info(f"Metadata for position {fen_string}: {cache_req.metadata}")
        
        return jsonify({
            'position_id': position_id,
            'fen_string': fen_string,
            'player_count': cache_req.player_count,
            'cached': True,
            'message': 'Position cached successfully'
        })
        
    except Exception as e:
        current_app.logger.error(f"Error caching position {fen_string}: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': 'Failed to cache position'
        }), 500


@api_bp.route('/positions/<path:fen_string>', methods=['DELETE'])
@require_session
def delete_position(fen_string: str):
    """
    Delete position data from cache.
    
    DELETE /api/v1/positions/{fen_string}
    
    Returns:
        Deletion status
    """
    try:
        # Check if database is available
        if not current_app.database:
            return jsonify({
                'error': 'Database not available',
                'message': 'Position cache is disabled'
            }), 503
        
        # Get position ID first
        position_id = current_app.database.get_position_id(fen_string)
        if position_id is None:
            return jsonify({
                'error': 'Position not found',
                'message': f'Position {fen_string} not in cache'
            }), 404
        
        # Delete position and all related analyses
        with current_app.database.get_connection() as conn:
            # Delete analyses first (foreign key constraint)
            conn.execute("""
                DELETE FROM analysis_results WHERE position_id = ?
            """, (position_id,))
            
            # Delete position
            conn.execute("""
                DELETE FROM positions WHERE id = ?
            """, (position_id,))
            
            conn.commit()
        
        return jsonify({
            'deleted': True,
            'fen_string': fen_string,
            'position_id': position_id,
            'message': 'Position and all analyses deleted successfully'
        })
        
    except Exception as e:
        current_app.logger.error(f"Error deleting position {fen_string}: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': 'Failed to delete position'
        }), 500


@api_bp.route('/positions/stats', methods=['GET'])
@require_session
def get_position_stats():
    """
    Get position cache statistics.
    
    GET /api/v1/positions/stats
    
    Returns:
        Cache statistics including position count, analysis count, etc.
    """
    try:
        # Check if database is available
        if not current_app.database:
            return jsonify({
                'error': 'Database not available',
                'message': 'Position cache is disabled'
            }), 503
        
        # Get cache statistics
        stats = current_app.database.get_cache_stats()
        
        # Get database info
        db_info = current_app.database.get_database_info()
        
        return jsonify({
            'positions_cached': stats['positions_cached'],
            'analyses_cached': stats['analyses_cached'],
            'by_search_type': stats['by_search_type'],
            'performance': stats['performance'],
            'database_info': {
                'total_size_mb': db_info['total_size_mb'],
                'db_size_bytes': db_info['db_size_bytes'],
                'wal_size_bytes': db_info['wal_size_bytes'],
                'journal_mode': db_info['journal_mode']
            }
        })
        
    except Exception as e:
        current_app.logger.error(f"Error getting position stats: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': 'Failed to retrieve cache statistics'
        }), 500


# Bulk Position Operations

@api_bp.route('/positions/bulk', methods=['POST'])
@require_session
def bulk_import_positions():
    """
    Bulk import positions into cache.
    
    POST /api/v1/positions/bulk
    {
        "positions": [
            {
                "fen_string": "position1",
                "player_count": 2,
                "compressed_state": "optional_data"
            }
        ],
        "overwrite": false
    }
    
    Returns:
        Import results with success/failure counts
    """
    try:
        # Check if database is available
        if not current_app.database:
            return jsonify({
                'error': 'Database not available',
                'message': 'Position cache is disabled'
            }), 503
        
        # Parse request data
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        # Validate request
        try:
            bulk_req = BulkPositionRequest(**data)
        except ValidationError as e:
            return jsonify({
                'error': 'Validation error',
                'message': str(e)
            }), 400
        
        # Process bulk import
        results = {
            'total_positions': len(bulk_req.positions),
            'imported': 0,
            'skipped': 0,
            'errors': [],
            'position_ids': []
        }
        
        for position in bulk_req.positions:
            try:
                # Check if position already exists
                existing_id = current_app.database.get_position_id(position.fen_string)
                
                if existing_id and not bulk_req.overwrite:
                    results['skipped'] += 1
                    continue
                
                # Import position
                if position.compressed_state:
                    position_id = current_app.database.cache_position_with_state(
                        position.fen_string, position.player_count, position.compressed_state
                    )
                else:
                    position_id = current_app.database.cache_position(
                        position.fen_string, position.player_count
                    )
                
                results['imported'] += 1
                results['position_ids'].append(position_id)
                
            except Exception as e:
                results['errors'].append({
                    'fen_string': position.fen_string,
                    'error': str(e)
                })
        
        return jsonify({
            'bulk_import': True,
            'results': results,
            'message': f'Bulk import completed: {results["imported"]} imported, {results["skipped"]} skipped'
        })
        
    except Exception as e:
        current_app.logger.error(f"Error in bulk import: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': 'Failed to process bulk import'
        }), 500


@api_bp.route('/positions/bulk', methods=['GET'])
@require_session
def bulk_export_positions():
    """
    Bulk export positions from cache.
    
    GET /api/v1/positions/bulk?limit=100&offset=0
    
    Returns:
        List of positions with metadata
    """
    try:
        # Check if database is available
        if not current_app.database:
            return jsonify({
                'error': 'Database not available',
                'message': 'Position cache is disabled'
            }), 503
        
        # Get query parameters
        limit = request.args.get('limit', 100, type=int)
        offset = request.args.get('offset', 0, type=int)
        
        # Validate parameters
        if limit > 1000:
            return jsonify({
                'error': 'Invalid parameter',
                'message': 'Limit cannot exceed 1000'
            }), 400
        
        # Export positions
        with current_app.database.get_connection() as conn:
            cursor = conn.execute("""
                SELECT id, fen_string, player_count, created_at,
                       compressed_state IS NOT NULL as has_compressed_state
                FROM positions 
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
            """, (limit, offset))
            
            positions = []
            for row in cursor.fetchall():
                # Get analysis count for each position
                analysis_cursor = conn.execute("""
                    SELECT COUNT(*) as analysis_count
                    FROM analysis_results 
                    WHERE position_id = ?
                """, (row['id'],))
                
                analysis_count = analysis_cursor.fetchone()['analysis_count']
                
                positions.append({
                    'position_id': row['id'],
                    'fen_string': row['fen_string'],
                    'player_count': row['player_count'],
                    'created_at': row['created_at'],
                    'has_compressed_state': bool(row['has_compressed_state']),
                    'analysis_count': analysis_count
                })
            
            # Get total count
            count_cursor = conn.execute("SELECT COUNT(*) as total FROM positions")
            total_count = count_cursor.fetchone()['total']
        
        return jsonify({
            'bulk_export': True,
            'positions': positions,
            'total_count': total_count,
            'limit': limit,
            'offset': offset,
            'returned_count': len(positions)
        })
        
    except Exception as e:
        current_app.logger.error(f"Error in bulk export: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': 'Failed to export positions'
        }), 500


@api_bp.route('/positions/bulk', methods=['DELETE'])
@require_session
def bulk_delete_positions():
    """
    Bulk delete positions from cache.
    
    DELETE /api/v1/positions/bulk
    {
        "fen_strings": ["position1", "position2"],
        "all": false
    }
    
    Returns:
        Deletion results
    """
    try:
        # Check if database is available
        if not current_app.database:
            return jsonify({
                'error': 'Database not available',
                'message': 'Position cache is disabled'
            }), 503
        
        # Parse request data
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        # Validate request
        fen_strings = data.get('fen_strings', [])
        delete_all = data.get('all', False)
        
        if not fen_strings and not delete_all:
            return jsonify({
                'error': 'Invalid request',
                'message': 'Must specify fen_strings or set all=true'
            }), 400
        
        # Process bulk deletion
        results = {
            'total_requested': len(fen_strings) if not delete_all else 'all',
            'deleted': 0,
            'not_found': 0,
            'errors': []
        }
        
        if delete_all:
            # Delete all positions
            with current_app.database.get_connection() as conn:
                # Get count before deletion
                count_cursor = conn.execute("SELECT COUNT(*) as total FROM positions")
                total_count = count_cursor.fetchone()['total']
                
                # Delete all analyses first
                conn.execute("DELETE FROM analysis_results")
                
                # Delete all positions
                conn.execute("DELETE FROM positions")
                
                conn.commit()
                
                results['deleted'] = total_count
        else:
            # Delete specific positions
            for fen_string in fen_strings:
                try:
                    position_id = current_app.database.get_position_id(fen_string)
                    if position_id is None:
                        results['not_found'] += 1
                        continue
                    
                    # Delete position and analyses
                    with current_app.database.get_connection() as conn:
                        conn.execute("""
                            DELETE FROM analysis_results WHERE position_id = ?
                        """, (position_id,))
                        
                        conn.execute("""
                            DELETE FROM positions WHERE id = ?
                        """, (position_id,))
                        
                        conn.commit()
                    
                    results['deleted'] += 1
                    
                except Exception as e:
                    results['errors'].append({
                        'fen_string': fen_string,
                        'error': str(e)
                    })
        
        return jsonify({
            'bulk_delete': True,
            'results': results,
            'message': f'Bulk deletion completed: {results["deleted"]} deleted, {results["not_found"]} not found'
        })
        
    except Exception as e:
        current_app.logger.error(f"Error in bulk deletion: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': 'Failed to process bulk deletion'
        }), 500


@api_bp.route('/positions/search', methods=['GET'])
@require_session
def search_positions():
    """
    Search positions in cache.
    
    GET /api/v1/positions/search?q=query&limit=50&offset=0
    
    Returns:
        Matching positions with metadata
    """
    try:
        # Check if database is available
        if not current_app.database:
            return jsonify({
                'error': 'Database not available',
                'message': 'Position cache is disabled'
            }), 503
        
        # Get query parameters
        query = request.args.get('q', '')
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        
        # Validate parameters
        if limit > 200:
            return jsonify({
                'error': 'Invalid parameter',
                'message': 'Limit cannot exceed 200'
            }), 400
        
        if not query:
            return jsonify({
                'error': 'Invalid parameter',
                'message': 'Query parameter "q" is required'
            }), 400
        
        # Search positions
        with current_app.database.get_connection() as conn:
            cursor = conn.execute("""
                SELECT id, fen_string, player_count, created_at,
                       compressed_state IS NOT NULL as has_compressed_state
                FROM positions 
                WHERE fen_string LIKE ?
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
            """, (f'%{query}%', limit, offset))
            
            positions = []
            for row in cursor.fetchall():
                # Get analysis count for each position
                analysis_cursor = conn.execute("""
                    SELECT COUNT(*) as analysis_count
                    FROM analysis_results 
                    WHERE position_id = ?
                """, (row['id'],))
                
                analysis_count = analysis_cursor.fetchone()['analysis_count']
                
                positions.append({
                    'position_id': row['id'],
                    'fen_string': row['fen_string'],
                    'player_count': row['player_count'],
                    'created_at': row['created_at'],
                    'has_compressed_state': bool(row['has_compressed_state']),
                    'analysis_count': analysis_count
                })
            
            # Get total count for this query
            count_cursor = conn.execute("""
                SELECT COUNT(*) as total 
                FROM positions 
                WHERE fen_string LIKE ?
            """, (f'%{query}%',))
            
            total_count = count_cursor.fetchone()['total']
        
        return jsonify({
            'search': True,
            'query': query,
            'positions': positions,
            'total_count': total_count,
            'limit': limit,
            'offset': offset,
            'returned_count': len(positions)
        })
        
    except Exception as e:
        current_app.logger.error(f"Error in position search: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': 'Failed to search positions'
        }), 500


# Analysis Cache API Endpoints

@api_bp.route('/analyses/<path:fen_string>', methods=['GET'])
@require_session
def get_analysis(fen_string: str):
    """
    Get cached analysis results for a position.
    
    GET /api/v1/analyses/{fen_string}?agent_id=0&search_type=mcts
    
    Returns:
        Cached analysis results with metadata
    """
    try:
        # Check if database is available
        if not current_app.database:
            return jsonify({
                'error': 'Database not available',
                'message': 'Analysis cache is disabled'
            }), 503
        
        # Get query parameters
        agent_id = request.args.get('agent_id', 0, type=int)
        search_type = request.args.get('search_type', 'mcts')
        
        # Get cached analysis
        cached_analysis = current_app.database.get_cached_analysis(
            fen_string, agent_id, search_type
        )
        
        if cached_analysis is None:
            return jsonify({
                'error': 'Analysis not found',
                'message': f'No {search_type} analysis found for position {fen_string}'
            }), 404
        
        return jsonify({
            'analysis_id': cached_analysis.position_id,
            'fen_string': fen_string,
            'agent_id': cached_analysis.agent_id,
            'search_type': cached_analysis.search_type,
            'best_move': cached_analysis.best_move,
            'best_score': cached_analysis.score,
            'search_time': cached_analysis.search_time,
            'nodes_searched': cached_analysis.nodes_searched,
            'rollout_count': cached_analysis.rollout_count,
            'created_at': cached_analysis.created_at.isoformat(),
            'principal_variation': cached_analysis.principal_variation,
            'cache_hit': True
        })
        
    except Exception as e:
        current_app.logger.error(f"Error getting analysis for {fen_string}: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': 'Failed to retrieve analysis data'
        }), 500


@api_bp.route('/analyses/<path:fen_string>', methods=['POST'])
@require_session
def store_analysis(fen_string: str):
    """
    Store analysis results in cache.
    
    POST /api/v1/analyses/{fen_string}
    {
        "agent_id": 0,
        "search_type": "mcts",
        "best_move": "move_string",
        "best_score": 0.5,
        "search_time": 0.2,
        "nodes_searched": 1000,
        "rollout_count": 50,
        "depth_reached": 3,
        "principal_variation": ["move1", "move2"],
        "metadata": {"source": "api", "parameters": {...}}
    }
    
    Returns:
        Analysis ID and cache status
    """
    try:
        # Check if database is available
        if not current_app.database:
            return jsonify({
                'error': 'Database not available',
                'message': 'Analysis cache is disabled'
            }), 503
        
        # Parse request data
        try:
            data = request.get_json(force=True)
        except Exception:
            data = None
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        # Validate request
        try:
            analysis_req = AnalysisCacheRequest(fen_string=fen_string, **data)
        except ValidationError as e:
            return jsonify({
                'error': 'Validation error',
                'message': str(e)
            }), 400
        
        # Cache position first
        position_id = current_app.database.cache_position(
            fen_string, 2  # Default to 2 players, could be made configurable
        )
        
        # Prepare analysis result
        analysis_result = {
            'best_move': analysis_req.best_move,
            'best_score': analysis_req.best_score,
            'search_time': analysis_req.search_time,
            'nodes_searched': analysis_req.nodes_searched,
            'rollout_count': analysis_req.rollout_count,
            'principal_variation': analysis_req.principal_variation or []
        }
        
        # Store analysis
        analysis_id = current_app.database.cache_analysis(
            position_id,
            analysis_req.agent_id,
            analysis_req.search_type,
            analysis_result
        )
        
        # Store metadata if provided
        if analysis_req.metadata:
            current_app.logger.info(f"Metadata for analysis {analysis_id}: {analysis_req.metadata}")
        
        return jsonify({
            'analysis_id': analysis_id,
            'position_id': position_id,
            'fen_string': fen_string,
            'agent_id': analysis_req.agent_id,
            'search_type': analysis_req.search_type,
            'cached': True,
            'message': 'Analysis cached successfully'
        })
        
    except Exception as e:
        current_app.logger.error(f"Error caching analysis for {fen_string}: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': 'Failed to cache analysis'
        }), 500


@api_bp.route('/analyses/<path:fen_string>', methods=['DELETE'])
@require_session
def delete_analysis(fen_string: str):
    """
    Delete analysis results from cache.
    
    DELETE /api/v1/analyses/{fen_string}?agent_id=0&search_type=mcts
    
    Returns:
        Deletion status
    """
    try:
        # Check if database is available
        if not current_app.database:
            return jsonify({
                'error': 'Database not available',
                'message': 'Analysis cache is disabled'
            }), 503
        
        # Get query parameters
        agent_id = request.args.get('agent_id', 0, type=int)
        search_type = request.args.get('search_type', 'mcts')
        
        # Get position ID
        position_id = current_app.database.get_position_id(fen_string)
        if position_id is None:
            return jsonify({
                'error': 'Position not found',
                'message': f'Position {fen_string} not in cache'
            }), 404
        
        # Delete specific analysis
        with current_app.database.get_connection() as conn:
            cursor = conn.execute("""
                DELETE FROM analysis_results 
                WHERE position_id = ? AND agent_id = ? AND search_type = ?
            """, (position_id, agent_id, search_type))
            
            deleted_count = cursor.rowcount
            conn.commit()
        
        if deleted_count == 0:
            return jsonify({
                'error': 'Analysis not found',
                'message': f'No {search_type} analysis found for position {fen_string}'
            }), 404
        
        return jsonify({
            'deleted': True,
            'fen_string': fen_string,
            'agent_id': agent_id,
            'search_type': search_type,
            'deleted_count': deleted_count,
            'message': f'Analysis deleted successfully'
        })
        
    except Exception as e:
        current_app.logger.error(f"Error deleting analysis for {fen_string}: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': 'Failed to delete analysis'
        }), 500


@api_bp.route('/analyses/stats', methods=['GET'])
@require_session
def get_analysis_stats():
    """
    Get analysis cache statistics.
    
    GET /api/v1/analyses/stats
    
    Returns:
        Analysis cache statistics and performance metrics
    """
    try:
        # Check if database is available
        if not current_app.database:
            return jsonify({
                'error': 'Database not available',
                'message': 'Analysis cache is disabled'
            }), 503
        
        # Get cache statistics
        stats = current_app.database.get_cache_stats()
        
        # Get query performance stats
        query_stats = current_app.database.get_query_performance_stats()
        
        # Get index usage stats
        index_stats = current_app.database.get_index_usage_stats()
        
        return jsonify({
            'analyses_cached': stats['analyses_cached'],
            'by_search_type': stats['by_search_type'],
            'performance': stats['performance'],
            'query_performance': query_stats,
            'index_usage': index_stats
        })
        
    except Exception as e:
        current_app.logger.error(f"Error getting analysis stats: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': 'Failed to retrieve analysis statistics'
        }), 500


@api_bp.route('/analyses/search', methods=['GET'])
@require_session
def search_analyses():
    """
    Search analyses by criteria.
    
    GET /api/v1/analyses/search?search_type=mcts&min_score=0.5&limit=50
    
    Returns:
        Matching analyses with metadata
    """
    try:
        # Check if database is available
        if not current_app.database:
            return jsonify({
                'error': 'Database not available',
                'message': 'Analysis cache is disabled'
            }), 503
        
        # Get query parameters
        search_type = request.args.get('search_type')
        agent_id = request.args.get('agent_id', type=int)
        min_score = request.args.get('min_score', type=float)
        max_score = request.args.get('max_score', type=float)
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        
        # Validate parameters
        if limit > 200:
            return jsonify({
                'error': 'Invalid parameter',
                'message': 'Limit cannot exceed 200'
            }), 400
        
        # Build query conditions
        conditions = []
        params = []
        
        if search_type:
            conditions.append("ar.search_type = ?")
            params.append(search_type)
        
        if agent_id is not None:
            conditions.append("ar.agent_id = ?")
            params.append(agent_id)
        
        if min_score is not None:
            conditions.append("ar.score >= ?")
            params.append(min_score)
        
        if max_score is not None:
            conditions.append("ar.score <= ?")
            params.append(max_score)
        
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        # Search analyses
        with current_app.database.get_connection() as conn:
            query = f"""
                SELECT ar.*, p.fen_string 
                FROM analysis_results ar
                JOIN positions p ON ar.position_id = p.id
                WHERE {where_clause}
                ORDER BY ar.created_at DESC
                LIMIT ? OFFSET ?
            """
            
            cursor = conn.execute(query, params + [limit, offset])
            
            analyses = []
            for row in cursor.fetchall():
                # Get principal variation
                pv_cursor = conn.execute("""
                    SELECT move_text FROM move_sequences 
                    WHERE analysis_id = ? ORDER BY move_order
                """, (row['id'],))
                
                principal_variation = [move_row['move_text'] for move_row in pv_cursor.fetchall()]
                
                analyses.append({
                    'analysis_id': row['id'],
                    'position_id': row['position_id'],
                    'fen_string': row['fen_string'],
                    'agent_id': row['agent_id'],
                    'search_type': row['search_type'],
                    'best_move': row['best_move'],
                    'best_score': row['score'],
                    'search_time': row['search_time'],
                    'nodes_searched': row['nodes_searched'],
                    'rollout_count': row['rollout_count'],
                    'created_at': row['created_at'],
                    'principal_variation': principal_variation
                })
            
            # Get total count for this query
            count_query = f"""
                SELECT COUNT(*) as total 
                FROM analysis_results ar
                JOIN positions p ON ar.position_id = p.id
                WHERE {where_clause}
            """
            
            count_cursor = conn.execute(count_query, params)
            total_count = count_cursor.fetchone()['total']
        
        return jsonify({
            'search': True,
            'analyses': analyses,
            'total_count': total_count,
            'limit': limit,
            'offset': offset,
            'returned_count': len(analyses),
            'filters': {
                'search_type': search_type,
                'agent_id': agent_id,
                'min_score': min_score,
                'max_score': max_score
            }
        })
        
    except Exception as e:
        current_app.logger.error(f"Error in analysis search: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': 'Failed to search analyses'
        }), 500


@api_bp.route('/analyses/recent', methods=['GET'])
@require_session
def get_recent_analyses():
    """
    Get recent analysis results.
    
    GET /api/v1/analyses/recent?limit=20&search_type=mcts
    
    Returns:
        Recent analyses with metadata
    """
    try:
        # Check if database is available
        if not current_app.database:
            return jsonify({
                'error': 'Database not available',
                'message': 'Analysis cache is disabled'
            }), 503
        
        # Get query parameters
        limit = request.args.get('limit', 20, type=int)
        search_type = request.args.get('search_type')
        
        # Validate parameters
        if limit > 100:
            return jsonify({
                'error': 'Invalid parameter',
                'message': 'Limit cannot exceed 100'
            }), 400
        
        # Get recent analyses
        recent_analyses = current_app.database.get_recent_analyses(limit)
        
        # Filter by search type if specified
        if search_type:
            recent_analyses = [a for a in recent_analyses if a.search_type == search_type]
        
        # Format response
        analyses = []
        for analysis in recent_analyses:
            analyses.append({
                'analysis_id': analysis.position_id,  # Using position_id as analysis_id for now
                'fen_string': 'unknown',  # Would need to get from positions table
                'agent_id': analysis.agent_id,
                'search_type': analysis.search_type,
                'best_move': analysis.best_move,
                'best_score': analysis.score,
                'search_time': analysis.search_time,
                'nodes_searched': analysis.nodes_searched,
                'rollout_count': analysis.rollout_count,
                'created_at': analysis.created_at.isoformat(),
                'principal_variation': analysis.principal_variation
            })
        
        return jsonify({
            'recent_analyses': True,
            'analyses': analyses,
            'limit': limit,
            'search_type_filter': search_type,
            'returned_count': len(analyses)
        })
        
    except Exception as e:
        current_app.logger.error(f"Error getting recent analyses: {e}")
        return jsonify({
            'error': 'Internal server error',
            'message': 'Failed to retrieve recent analyses'
        }), 500


@api_bp.route('/analyze', methods=['POST'])
def analyze_position():
    """
    Analyze a game position with exact search.
    
    POST /api/v1/analyze
    {
        "fen_string": "game state in FEN format",
        "agent_id": 0,
        "depth": 3,
        "time_budget": 4.0
    }
    """
    try:
        # Check rate limiting
        session_id = request.headers.get('X-Session-ID')
        if current_app.rate_limiter and not current_app.rate_limiter.check_rate_limit(session_id, "heavy"):
            return jsonify({
                'error': 'Rate limit exceeded',
                'message': 'Too many heavy analysis requests'
            }), 429
        
        # Parse request
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        analysis_req = AnalysisRequest(**data)
        
        # Parse game state
        state = parse_fen_string(analysis_req.fen_string)
        
        # Import search components
        from core.azul_search import AzulAlphaBetaSearch
        
        # Create search engine
        search_engine = AzulAlphaBetaSearch(
            max_depth=analysis_req.depth or 3,
            max_time=analysis_req.time_budget or 4.0
        )
        
        # Perform search
        result = search_engine.search(
            state, 
            analysis_req.agent_id, 
            max_depth=analysis_req.depth or 3,
            max_time=analysis_req.time_budget or 4.0
        )
        search_time = getattr(result, 'search_time', 0.0)
        
        # Format response
        response = {
            'success': True,
            'analysis': {
                'best_move': format_move(result.best_move) if result.best_move else None,
                'best_score': result.best_score,
                'principal_variation': [format_move(move) for move in result.principal_variation],
                'search_time': search_time,
                'nodes_searched': result.nodes_searched,
                'depth_reached': result.depth_reached
            },
            'position': {
                'fen_string': analysis_req.fen_string,
                'agent_id': analysis_req.agent_id
            }
        }
        
        # Cache result if database is available
        if hasattr(current_app, 'database') and current_app.database:
            try:
                position_id = current_app.database.cache_position(analysis_req.fen_string, len(state.agents))
                current_app.database.cache_analysis(position_id, analysis_req.agent_id, 'alpha_beta', {
                    'best_move': str(result.best_move) if result.best_move else None,
                    'best_score': result.best_score,
                    'search_time': result.search_time,
                    'nodes_searched': result.nodes_searched,
                    'depth_reached': result.depth_reached,
                    'principal_variation': [str(move) for move in result.principal_variation]
                })
            except Exception as e:
                current_app.logger.warning(f"Failed to cache analysis: {e}")
        
        return jsonify(response)
        
    except ValidationError as e:
        return jsonify({'error': 'Invalid request data', 'details': e.errors()}), 400
    except ValueError as e:
        return jsonify({'error': 'Invalid position', 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'error': 'Analysis failed', 'message': str(e)}), 500


@api_bp.route('/hint', methods=['POST'])
def get_hint():
    """
    Get a fast hint for a game position.
    
    POST /api/v1/hint
    {
        "fen_string": "game state in FEN format",
        "agent_id": 0,
        "budget": 0.2,
        "rollouts": 100
    }
    """
    try:
        # Skip rate limiting for local development
        # session_id = request.headers.get('X-Session-ID')
        # if current_app.rate_limiter and not current_app.rate_limiter.check_rate_limit(session_id, "light"):
        #     return jsonify({
        #         'error': 'Rate limit exceeded',
        #         'message': 'Too many hint requests'
        #     }), 429
        
        # Parse request
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        hint_req = HintRequest(**data)
        
        # Parse game state
        state = parse_fen_string(hint_req.fen_string)
        
        # Import MCTS components
        from core.azul_mcts import AzulMCTS
        
        # Create MCTS engine
        mcts_engine = AzulMCTS(
            max_time=hint_req.budget,
            max_rollouts=hint_req.rollouts,
            database=getattr(current_app, 'database', None)
        )
        
        # Perform search
        result = mcts_engine.search(state, hint_req.agent_id)
        search_time = getattr(result, 'search_time', 0.0)
        
        # Format response
        response = {
            'success': True,
            'hint': {
                'best_move': format_move(result.best_move) if result.best_move else None,
                'expected_value': result.best_score,
                'confidence': min(1.0, result.nodes_searched / 100.0),  # Simple confidence based on nodes
                'search_time': search_time,
                'rollouts_performed': result.rollout_count,
                'top_moves': [
                    {
                        'move': format_move(result.best_move),
                        'score': result.best_score,
                        'visits': result.nodes_searched
                    }
                ] if result.best_move else []
            },
            'position': {
                'fen_string': hint_req.fen_string,
                'agent_id': hint_req.agent_id
            }
        }
        
        # Cache result if database is available
        if hasattr(current_app, 'database') and current_app.database:
            try:
                position_id = current_app.database.cache_position(
                    hint_req.fen_string, 
                    len(state.agents)
                )
                current_app.database.cache_analysis(
                    position_id,
                    hint_req.agent_id,
                    'mcts',
                    {
                        'best_move': str(result.best_move) if result.best_move else None,
                        'best_score': result.best_score,
                        'search_time': search_time,
                        'nodes_searched': result.nodes_searched,
                        'rollout_count': result.rollout_count,
                        'principal_variation': [str(move) for move in result.principal_variation]
                    }
                )
                
                # Update performance stats
                current_app.database.update_performance_stats(
                    'mcts', search_time, result.nodes_searched, result.rollout_count, False
                )
            except Exception as e:
                # Log but don't fail the request
                current_app.logger.warning(f"Failed to cache hint: {e}")
        
        return jsonify(response)
        
    except ValidationError as e:
        return jsonify({'error': 'Invalid request data', 'details': e.errors()}), 400
    except ValueError as e:
        return jsonify({'error': 'Invalid position', 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'error': 'Hint generation failed', 'message': str(e)}), 500


@api_bp.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    # Check rate limit if session is provided
    session_id = request.headers.get('X-Session-ID')
    if session_id and current_app.rate_limiter:
        if not current_app.rate_limiter.check_rate_limit(session_id, "general"):
            return jsonify({
                'error': 'Rate limit exceeded',
                'message': 'Too many requests'
            }), 429
    
    return jsonify({
        'status': 'healthy',
        'version': '0.1.0',
        'timestamp': time.time()
    })


@api_bp.route('/stats', methods=['GET'])
@require_session
def get_api_stats():
    """Get API usage statistics."""
    session_id = request.headers.get('X-Session-ID')
    
    return jsonify({
        'rate_limits': current_app.rate_limiter.get_remaining_requests(session_id) if current_app.rate_limiter else {},
        'session_stats': current_app.session_manager.get_session_stats() if hasattr(current_app, 'session_manager') else {}
    }) 


@api_bp.route('/analyze_neural', methods=['POST'])
def analyze_neural():
    """Analyze position using neural MCTS."""
    try:
        data = request.get_json()
        
        # Parse request
        fen_string = data.get('fen', 'initial')
        agent_id = data.get('agent_id', 0)
        time_budget = data.get('time_budget', 2.0)
        max_rollouts = data.get('max_rollouts', 100)
        
        # Parse FEN and create state
        state = parse_fen_string(fen_string)
        if state is None:
            return jsonify({'error': 'Invalid FEN string'}), 400
        
        # Check if neural components are available
        try:
            from core.azul_mcts import AzulMCTS, RolloutPolicy
            from neural.azul_net import create_azul_net, AzulNeuralRolloutPolicy
            
            # Create neural MCTS
            mcts = AzulMCTS(
                rollout_policy=RolloutPolicy.NEURAL,
                max_time=time_budget,
                max_rollouts=max_rollouts,
                database=getattr(current_app, 'database', None)
            )
            
            # Perform search
            result = mcts.search(state, agent_id=agent_id, fen_string=fen_string)
            
            # Format response
            analysis = {
                'best_move': format_move(result.best_move),
                'best_score': result.best_score,
                'principal_variation': [format_move(move) for move in result.principal_variation],
                'search_time': result.search_time,
                'nodes_searched': result.nodes_searched,
                'rollout_count': result.rollout_count,
                'average_rollout_depth': result.average_rollout_depth,
                'method': 'neural_mcts'
            }
            
            # Cache result if database available
            if hasattr(current_app, 'database') and current_app.database:
                try:
                    position_id = current_app.database.cache_position(fen_string, len(state.agents))
                    current_app.database.cache_analysis(position_id, agent_id, 'neural_mcts', analysis)
                except Exception as e:
                    current_app.logger.warning(f"Failed to cache neural analysis: {e}")
            
            return jsonify({
                'success': True,
                'analysis': analysis
            })
            
        except ImportError as e:
            return jsonify({
                'error': 'Neural analysis not available',
                'message': 'PyTorch and neural components are not installed. Install with: pip install torch',
                'details': str(e)
            }), 503
            
        except Exception as e:
            return jsonify({
                'error': 'Neural analysis failed',
                'message': 'Neural model not trained or available',
                'details': str(e)
            }), 500
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================================
# B2.3: Performance API Endpoints
# ============================================================================

@api_bp.route('/performance/stats', methods=['GET'])
@require_session
def get_performance_stats():
    """
    Get comprehensive performance statistics.
    
    GET /api/v1/performance/stats
    Query parameters:
    - search_type: Optional search type filter
    - time_range_hours: Optional time range filter
    - include_query_stats: Include query performance stats (default: true)
    - include_index_stats: Include index usage stats (default: true)
    
    Returns:
        Comprehensive performance statistics including search performance,
        query performance, index usage, and cache analytics.
    """
    try:
        # Parse query parameters
        search_type = request.args.get('search_type')
        time_range_hours = request.args.get('time_range_hours', type=int)
        include_query_stats = request.args.get('include_query_stats', 'true').lower() == 'true'
        include_index_stats = request.args.get('include_index_stats', 'true').lower() == 'true'
        
        # Get database stats
        db_stats = current_app.database.get_cache_stats()
        
        # Get performance stats
        perf_stats = current_app.database.get_performance_stats(search_type)
        
        # Build response
        response = {
            'timestamp': time.time(),
            'search_performance': {
                'by_search_type': db_stats.get('by_search_type', {}),
                'performance_stats': perf_stats
            },
            'cache_analytics': {
                'positions_cached': db_stats.get('positions_cached', 0),
                'analyses_cached': db_stats.get('analyses_cached', 0),
                'cache_hit_rate': db_stats.get('cache_hit_rate', 0.0),
                'total_cache_size_mb': db_stats.get('total_cache_size_mb', 0.0)
            }
        }
        
        # Add query performance stats if requested
        if include_query_stats:
            query_stats = current_app.database.get_query_performance_stats()
            response['query_performance'] = query_stats
        
        # Add index usage stats if requested
        if include_index_stats:
            index_stats = current_app.database.get_index_usage_stats()
            response['index_usage'] = index_stats
        
        return jsonify(response)
        
    except Exception as e:
        current_app.logger.error(f"Error getting performance stats: {e}")
        return jsonify({'error': 'Failed to get performance stats', 'message': str(e)}), 500


@api_bp.route('/performance/health', methods=['GET'])
@require_session
def get_system_health():
    """
    Get comprehensive system health status.
    
    GET /api/v1/performance/health
    Query parameters:
    - include_database_health: Include database health checks (default: true)
    - include_performance_metrics: Include performance metrics (default: true)
    - include_cache_analytics: Include cache analytics (default: true)
    
    Returns:
        System health status including database integrity, performance metrics,
        and cache analytics.
    """
    try:
        # Parse query parameters
        include_database_health = request.args.get('include_database_health', 'true').lower() == 'true'
        include_performance_metrics = request.args.get('include_performance_metrics', 'true').lower() == 'true'
        include_cache_analytics = request.args.get('include_cache_analytics', 'true').lower() == 'true'
        
        # Basic health check
        health_status = {
            'status': 'healthy',
            'timestamp': time.time(),
            'version': '0.1.0'
        }
        
        # Database health check
        if include_database_health:
            try:
                db_info = current_app.database.get_database_info()
                health_status['database'] = {
                    'status': 'healthy',
                    'file_size_mb': db_info.get('file_size_mb', 0),
                    'total_pages': db_info.get('total_pages', 0),
                    'free_pages': db_info.get('free_pages', 0),
                    'page_size': db_info.get('page_size', 0),
                    'integrity_check': 'ok'  # We'll add actual integrity check if needed
                }
            except Exception as e:
                health_status['database'] = {
                    'status': 'unhealthy',
                    'error': str(e)
                }
                health_status['status'] = 'degraded'
        
        # Performance metrics
        if include_performance_metrics:
            try:
                perf_stats = current_app.database.get_performance_stats()
                health_status['performance'] = {
                    'status': 'healthy',
                    'total_searches': sum(stat.get('total_searches', 0) for stat in perf_stats),
                    'average_search_time_ms': sum(stat.get('average_search_time_ms', 0) for stat in perf_stats) / max(len(perf_stats), 1),
                    'cache_hit_rate': sum(stat.get('cache_hit_rate', 0) for stat in perf_stats) / max(len(perf_stats), 1)
                }
            except Exception as e:
                health_status['performance'] = {
                    'status': 'unhealthy',
                    'error': str(e)
                }
                health_status['status'] = 'degraded'
        
        # Cache analytics
        if include_cache_analytics:
            try:
                cache_stats = current_app.database.get_cache_stats()
                health_status['cache'] = {
                    'status': 'healthy',
                    'positions_cached': cache_stats.get('positions_cached', 0),
                    'analyses_cached': cache_stats.get('analyses_cached', 0),
                    'cache_hit_rate': cache_stats.get('cache_hit_rate', 0.0),
                    'total_size_mb': cache_stats.get('total_cache_size_mb', 0.0)
                }
            except Exception as e:
                health_status['cache'] = {
                    'status': 'unhealthy',
                    'error': str(e)
                }
                health_status['status'] = 'degraded'
        
        return jsonify(health_status)
        
    except Exception as e:
        current_app.logger.error(f"Error getting system health: {e}")
        return jsonify({
            'status': 'unhealthy',
            'error': 'Failed to get system health',
            'message': str(e),
            'timestamp': time.time()
        }), 500


@api_bp.route('/performance/optimize', methods=['POST'])
@require_session
def optimize_database():
    """
    Optimize database performance.
    
    POST /api/v1/performance/optimize
    
    Returns:
        Database optimization results including VACUUM and ANALYZE operations.
    """
    try:
        # Perform database optimization
        optimization_result = current_app.database.optimize_database()
        
        return jsonify({
            'success': True,
            'optimization_result': optimization_result,
            'timestamp': time.time()
        })
        
    except Exception as e:
        current_app.logger.error(f"Error optimizing database: {e}")
        return jsonify({'error': 'Failed to optimize database', 'message': str(e)}), 500


@api_bp.route('/performance/analytics', methods=['GET'])
@require_session
def get_cache_analytics():
    """
    Get detailed cache analytics and performance insights.
    
    GET /api/v1/performance/analytics
    Query parameters:
    - search_type: Optional search type filter
    - limit: Number of high-quality analyses to return (default: 10)
    
    Returns:
        Detailed cache analytics including high-quality analyses,
        performance trends, and optimization recommendations.
    """
    try:
        # Parse query parameters
        search_type = request.args.get('search_type')
        limit = request.args.get('limit', 10, type=int)
        
        # Get cache stats
        cache_stats = current_app.database.get_cache_stats()
        
        # Get high-quality analyses if search_type specified
        high_quality_analyses = []
        if search_type:
            try:
                high_quality_analyses = current_app.database.get_high_quality_analyses(search_type, limit)
                # Convert to serializable format
                high_quality_analyses = [
                    {
                        'position_id': analysis.position_id,
                        'agent_id': analysis.agent_id,
                        'search_type': analysis.search_type,
                        'best_move': analysis.best_move,
                        'score': analysis.score,
                        'search_time': analysis.search_time,
                        'nodes_searched': analysis.nodes_searched,
                        'rollout_count': analysis.rollout_count,
                        'created_at': analysis.created_at.isoformat() if analysis.created_at else None,
                        'principal_variation': analysis.principal_variation
                    }
                    for analysis in high_quality_analyses
                ]
            except Exception as e:
                current_app.logger.warning(f"Failed to get high-quality analyses: {e}")
        
        # Get analysis stats by type
        analysis_stats = {}
        if search_type:
            try:
                analysis_stats = current_app.database.get_analysis_stats_by_type(search_type)
            except Exception as e:
                current_app.logger.warning(f"Failed to get analysis stats: {e}")
        
        # Build analytics response
        analytics = {
            'timestamp': time.time(),
            'cache_overview': {
                'positions_cached': cache_stats.get('positions_cached', 0),
                'analyses_cached': cache_stats.get('analyses_cached', 0),
                'cache_hit_rate': cache_stats.get('cache_hit_rate', 0.0),
                'total_size_mb': cache_stats.get('total_cache_size_mb', 0.0)
            },
            'performance_metrics': {
                'by_search_type': cache_stats.get('by_search_type', {}),
                'performance': cache_stats.get('performance', {})
            },
            'high_quality_analyses': high_quality_analyses,
            'analysis_stats': analysis_stats
        }
        
        return jsonify(analytics)
        
    except Exception as e:
        current_app.logger.error(f"Error getting cache analytics: {e}")
        return jsonify({'error': 'Failed to get cache analytics', 'message': str(e)}), 500


@api_bp.route('/performance/monitoring', methods=['GET'])
@require_session
def get_monitoring_data():
    """
    Get real-time monitoring data for system performance.
    
    GET /api/v1/performance/monitoring
    
    Returns:
        Real-time monitoring data including query performance,
        index usage, and system metrics.
    """
    try:
        # Get query performance stats
        query_stats = current_app.database.get_query_performance_stats()
        
        # Get index usage stats
        index_stats = current_app.database.get_index_usage_stats()
        
        # Get database info
        db_info = current_app.database.get_database_info()
        
        # Build monitoring response
        monitoring_data = {
            'timestamp': time.time(),
            'query_performance': query_stats,
            'index_usage': index_stats,
            'database_metrics': {
                'file_size_mb': db_info.get('file_size_mb', 0),
                'total_pages': db_info.get('total_pages', 0),
                'free_pages': db_info.get('free_pages', 0),
                'page_size': db_info.get('page_size', 0),
                'cache_size_pages': db_info.get('cache_size_pages', 0)
            },
            'system_metrics': {
                'uptime': time.time(),  # Could be enhanced with actual uptime tracking
                'memory_usage_mb': 0,  # Could be enhanced with actual memory tracking
                'active_connections': 1  # Could be enhanced with connection pooling
            }
        }
        
        return jsonify(monitoring_data)
        
    except Exception as e:
        current_app.logger.error(f"Error getting monitoring data: {e}")
        return jsonify({'error': 'Failed to get monitoring data', 'message': str(e)}), 500


@api_bp.route('/execute_move', methods=['POST'])
# @require_session # Removed for local development
def execute_move():
    """Execute a move and return new game state."""
    try:
        print("DEBUG: execute_move endpoint called")
        
        try:
            data = request.get_json(force=True)
            print(f"DEBUG: Raw data received: {data}")
        except Exception as e:
            print(f"DEBUG: Error parsing JSON: {e}")
            data = None
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        print("DEBUG: About to create MoveExecutionRequest")
        request_model = MoveExecutionRequest(**data)
        print(f"DEBUG: Request model created: {request_model}")
        
        # Parse current state
        try:
            print("DEBUG: About to parse FEN string")
            state = parse_fen_string(request_model.fen_string)
            print(f"DEBUG: FEN parsed successfully - agent count: {len(state.agents)}, factories: {len(state.factories)}")
        except ValueError as e:
            print(f"DEBUG: FEN parsing error: {e}")
            return jsonify({'error': f'Invalid FEN string: {str(e)}'}), 400
        except Exception as e:
            print(f"DEBUG: Unexpected error parsing FEN: {e}")
            return jsonify({'error': f'Error parsing game state: {str(e)}'}), 500
        
        # Convert frontend move format to engine move format
        try:
            print("DEBUG: About to convert frontend move")
            move_data = request_model.move
            engine_move = convert_frontend_move_to_engine(move_data)
            print(f"DEBUG: Converted engine move: {engine_move}")
        except Exception as e:
            print(f"DEBUG: Error converting move: {e}")
            return jsonify({'error': f'Error converting move: {str(e)}'}), 500
        
        # Generate legal moves
        try:
            print("DEBUG: About to generate legal moves")
            from core.azul_move_generator import FastMoveGenerator
            generator = FastMoveGenerator()
            legal_moves = generator.generate_moves_fast(state, request_model.agent_id)
            print(f"DEBUG: Generated {len(legal_moves)} legal moves")
        except Exception as e:
            print(f"DEBUG: Error generating moves: {e}")
            return jsonify({'error': f'Error generating legal moves: {str(e)}'}), 500
        
        # Find matching move
        try:
            print("DEBUG: About to find matching move")
            matching_move = find_matching_move(engine_move, legal_moves)
            print(f"DEBUG: Matching move found: {matching_move}")
            if not matching_move:
                print(f"DEBUG: No matching move found. Engine move: {engine_move}")
                return jsonify({'error': 'Illegal move'}), 400
        except Exception as e:
            print(f"DEBUG: Error finding matching move: {e}")
            return jsonify({'error': f'Error validating move: {str(e)}'}), 500
        
        # Apply move using game rule
        try:
            print("DEBUG: About to apply move")
            from core.azul_utils import Action, TileGrab
            
            # Convert FastMove to action format expected by generateSuccessor
            tg = TileGrab()
            tg.tile_type = matching_move.tile_type
            tg.number = matching_move.num_to_pattern_line + matching_move.num_to_floor_line
            tg.pattern_line_dest = matching_move.pattern_line_dest
            tg.num_to_pattern_line = matching_move.num_to_pattern_line
            tg.num_to_floor_line = matching_move.num_to_floor_line
            
            if matching_move.action_type == 1:  # Factory move
                action = (Action.TAKE_FROM_FACTORY, matching_move.source_id, tg)
            else:  # Center move
                action = (Action.TAKE_FROM_CENTRE, -1, tg)
            
            # Apply the move using game rule
            from core.azul_model import AzulGameRule
            game_rule = AzulGameRule(len(state.agents))
            new_state = game_rule.generateSuccessor(state, action, request_model.agent_id)
            print("DEBUG: Move applied successfully")
            
            # Update the current game state
            update_current_game_state(new_state)
            
            # Convert back to FEN
            new_fen = state_to_fen(new_state)
            print(f"DEBUG: New FEN: {new_fen}")
            
        except Exception as e:
            print(f"DEBUG: Error applying move: {e}")
            return jsonify({'error': f'Error applying move: {str(e)}'}), 500
        
        # Return the actual response
        return jsonify({
            'success': True,
            'new_fen': new_fen,
            'move_executed': format_move(matching_move),
            'game_over': new_state.is_game_over(),
            'scores': [agent.score for agent in new_state.agents],
            'engine_response': None  # Temporarily disabled
        })
        
    except ValidationError as e:
        return jsonify({'error': f'Invalid request: {str(e)}'}), 400
    except Exception as e:
        import traceback
        print(f"ERROR in execute_move: {str(e)}")
        print(f"Traceback: {traceback.format_exc()}")
        return jsonify({'error': f'Failed to execute move: {str(e)}'}), 500


def convert_frontend_move_to_engine(move_data: Dict[str, Any]) -> Dict[str, Any]:
    """Convert frontend move format to engine move format."""
    # Frontend format: {sourceId, tileType, patternLineDest, numToPatternLine, numToFloorLine}
    # Engine format: FastMove(action_type, source_id, tile_type, pattern_line_dest, num_to_pattern_line, num_to_floor_line)
    
    # Handle both snake_case and camelCase field names
    source_id = move_data.get('source_id', move_data.get('sourceId', 0))
    tile_type = move_data.get('tile_type', move_data.get('tileType', 0))
    pattern_line_dest = move_data.get('pattern_line_dest', move_data.get('patternLineDest', -1))
    num_to_pattern_line = move_data.get('num_to_pattern_line', move_data.get('numToPatternLine', 0))
    num_to_floor_line = move_data.get('num_to_floor_line', move_data.get('numToFloorLine', 0))
    
    # Handle string tile types from frontend
    if isinstance(tile_type, str):
        # Map string tile types to integers
        tile_color_map = {
            'B': 0,  # Blue
            'Y': 1,  # Yellow  
            'R': 2,  # Red
            'K': 3,  # Black
            'W': 4   # White
        }
        tile_type = tile_color_map.get(tile_type.upper(), 0)
    
    # Ensure tile_type is an integer (convert from enum if needed)
    if hasattr(tile_type, 'value'):
        tile_type = tile_type.value
    tile_type = int(tile_type)
    
    # Determine action type based on source_id
    # Factory moves (source_id >= 0) are action_type 1, center moves (source_id < 0) are action_type 2
    action_type = 1 if source_id >= 0 else 2
    
    return {
        'action_type': action_type,
        'source_id': source_id,
        'tile_type': tile_type,
        'pattern_line_dest': pattern_line_dest,
        'num_to_pattern_line': num_to_pattern_line,
        'num_to_floor_line': num_to_floor_line
    }


def find_matching_move(engine_move: Dict[str, Any], legal_moves: List) -> Optional[object]:
    """Find matching move in legal moves list."""
    print(f"DEBUG: Looking for match with engine move: {engine_move}")
    print(f"DEBUG: Engine move type: {type(engine_move)}")
    print(f"DEBUG: Engine move keys: {engine_move.keys()}")
    
    for i, move in enumerate(legal_moves):
        print(f"DEBUG: Checking legal move {i}: action_type={move.action_type}, source_id={move.source_id}, tile_type={move.tile_type}, pattern_line_dest={move.pattern_line_dest}, num_to_pattern_line={move.num_to_pattern_line}, num_to_floor_line={move.num_to_floor_line}")
        print(f"DEBUG: Move type: {type(move)}")
        
        # Check each field individually
        action_match = move.action_type == engine_move['action_type']
        source_match = move.source_id == engine_move['source_id']
        tile_match = move.tile_type == engine_move['tile_type']
        pattern_match = move.pattern_line_dest == engine_move['pattern_line_dest']
        num_pattern_match = move.num_to_pattern_line == engine_move['num_to_pattern_line']
        num_floor_match = move.num_to_floor_line == engine_move['num_to_floor_line']
        
        print(f"DEBUG: Matches - action: {action_match}, source: {source_match}, tile: {tile_match}, pattern: {pattern_match}, num_pattern: {num_pattern_match}, num_floor: {num_floor_match}")
        
        if (action_match and source_match and tile_match and 
            pattern_match and num_pattern_match and num_floor_match):
            print(f"DEBUG: Found matching move at index {i}")
            return move
    
    print(f"DEBUG: No matching move found")
    return None


def get_engine_response(state, agent_id: int) -> Optional[Dict[str, Any]]:
    """Get engine response move for the given state."""
    try:
        from core.azul_mcts import AzulMCTS
        mcts = AzulMCTS()
        result = mcts.search(state, agent_id, max_time=0.1, max_rollouts=50)
        
        if result and result.best_move:
            return {
                'move': format_move(result.best_move),
                'score': result.best_score,
                'search_time': result.search_time
            }
    except Exception as e:
        print(f"Engine response error: {e}")
    
    return None


def state_to_fen(state) -> str:
    """Convert game state to FEN string."""
    global _current_game_state
    
    # If this is the current game state, return a unique identifier
    if state is _current_game_state:
        # Generate a unique state identifier based on the state's content
        # This is a simple hash-based approach for now
        import hashlib
        import json
        
        try:
            # Create a hash of the state's key components using JSON instead of pickle
            state_data = {
                'factories': [(i, dict(factory.tiles)) for i, factory in enumerate(state.factories)],
                'center': dict(state.centre_pool.tiles),
                'agents': [
                    {
                        'lines_tile': agent.lines_tile,
                        'lines_number': agent.lines_number,
                        'grid_state': agent.grid_state,
                        'floor_tiles': agent.floor_tiles,
                        'score': agent.score
                    }
                    for agent in state.agents
                ],
                'current_player': getattr(state, 'current_player', state.first_agent)
            }
            
            # Create a hash of the state data using JSON
            state_json = json.dumps(state_data, sort_keys=True)
            state_hash = hashlib.md5(state_json.encode('utf-8')).hexdigest()[:8]
            
            return f"state_{state_hash}"
        except Exception as e:
            # Fallback to a simple timestamp-based identifier if serialization fails
            import time
            timestamp = int(time.time() * 1000) % 1000000
            return f"state_{timestamp}"
    
    # For other states, return "initial" for backward compatibility
    return "initial" 


@api_bp.route('/create_game', methods=['POST'])
def create_game():
    """Create a new game with specified player count."""
    try:
        try:
            data = request.get_json(force=True)
        except Exception:
            data = {}
        
        request_model = GameCreationRequest(**(data or {}))
        
        print(f"DEBUG: Creating new game with {request_model.player_count} players")
        
        # Validate player count - only 2 players supported
        if request_model.player_count != 2:
            return jsonify({'error': 'Only 2-player games are supported'}), 400
        
        # Create new game state
        from core.azul_model import AzulState
        import random
        import time
        
        # Use seed if provided, otherwise use time-based seed
        if request_model.seed is not None:
            random.seed(request_model.seed)
        else:
            # Use a time-based seed for true randomness
            random.seed(int(time.time() * 1000) % 2**32)
        
        # Create new game state
        new_state = AzulState(request_model.player_count)
        
        # Reset the random seed
        random.seed()
        
        # Update global game state
        global _current_game_state, _initial_game_state
        _current_game_state = new_state
        _initial_game_state = copy.deepcopy(new_state)
        
        # Generate a unique identifier for this state
        state_id = f"state_{int(time.time() * 1000) % 1000000}"
        
        return jsonify({
            'success': True,
            'fen_string': state_id,
            'player_count': request_model.player_count,
            'message': f'New {request_model.player_count}-player game created'
        })
        
    except Exception as e:
        print(f"ERROR in create_game: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Game creation failed: {str(e)}'}), 500


@api_bp.route('/game_state', methods=['GET'])
def get_game_state():
    """Get the current game state for display."""
    global _current_editable_game_state
    
    try:
        # If we have a stored editable game state, return it
        if _current_editable_game_state is not None:
            return jsonify({
                'success': True,
                'game_state': _current_editable_game_state
            })
        
        # Otherwise, parse current state from FEN
        fen_string = request.args.get('fen_string', 'initial')
        try:
            state = parse_fen_string(fen_string)
        except ValueError:
            # For invalid FEN, return default initial state
            from core.azul_model import AzulState
            state = AzulState(2)
        
        # Convert state to frontend format
        game_state = {
            'factories': [],
            'center': [],
            'players': []
        }
        
        # Convert factories
        for factory in state.factories:
            factory_tiles = []
            for tile_type, count in factory.tiles.items():
                for _ in range(count):
                    # Convert tile type to color string
                    tile_colors = {0: 'B', 1: 'Y', 2: 'R', 3: 'K', 4: 'W'}
                    factory_tiles.append(tile_colors.get(tile_type, 'W'))
            game_state['factories'].append(factory_tiles)
        
        # Convert center pool
        center_tiles = []
        for tile_type, count in state.centre_pool.tiles.items():
            for _ in range(count):
                tile_colors = {0: 'B', 1: 'Y', 2: 'R', 3: 'K', 4: 'W'}
                center_tiles.append(tile_colors.get(tile_type, 'W'))
        game_state['center'] = center_tiles
        
        # Convert player states
        for agent in state.agents:
            player = {
                'pattern_lines': [],
                'wall': [],
                'floor': []
            }
            
            # Convert pattern lines
            for i in range(5):
                line = []
                if agent.lines_tile[i] != -1:
                    tile_colors = {0: 'B', 1: 'Y', 2: 'R', 3: 'K', 4: 'W'}
                    tile_color = tile_colors.get(agent.lines_tile[i], 'W')
                    for _ in range(agent.lines_number[i]):
                        line.append(tile_color)
                player['pattern_lines'].append(line)
            
            # Convert wall
            for row in range(5):
                wall_row = []
                for col in range(5):
                    if agent.grid_state[row][col] != 0:
                        tile_colors = {0: 'B', 1: 'Y', 2: 'R', 3: 'K', 4: 'W'}
                        tile_color = tile_colors.get(agent.grid_state[row][col], 'W')
                        wall_row.append(tile_color)
                    else:
                        wall_row.append(False)
                player['wall'].append(wall_row)
            
            # Convert floor
            floor_tiles = []
            for tile_type in agent.floor_tiles:
                tile_colors = {0: 'B', 1: 'Y', 2: 'R', 3: 'K', 4: 'W'}
                floor_tiles.append(tile_colors.get(tile_type, 'W'))
            player['floor'] = floor_tiles
            
            game_state['players'].append(player)
        
        return jsonify({
            'success': True,
            'game_state': game_state
        })
        
    except Exception as e:
        return jsonify({
            'error': f'Failed to get game state: {str(e)}'
        }), 500


@api_bp.route('/game_state', methods=['PUT'])
def put_game_state():
    """Update the current game state from frontend."""
    global _current_editable_game_state
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        fen_string = data.get('fen_string', 'initial')
        game_state = data.get('game_state')
        
        if not game_state:
            return jsonify({'error': 'No game_state provided'}), 400
        
        # Store the game state for future retrieval
        _current_editable_game_state = game_state
        
        return jsonify({
            'success': True,
            'message': 'Game state saved successfully',
            'fen_string': fen_string
        })
        
    except Exception as e:
        return jsonify({
            'error': f'Failed to save game state: {str(e)}'
        }), 500


@api_bp.route('/reset_game', methods=['POST'])
def reset_game():
    """Reset the current game state to initial position."""
    global _current_game_state, _initial_game_state, _current_editable_game_state
    from core.azul_model import AzulState
    
    # Reset to the consistent initial state
    if _initial_game_state is None:
        random.seed(42)
        _initial_game_state = AzulState(2)
        random.seed()
    
    _current_game_state = copy.deepcopy(_initial_game_state)
    
    # Clear the editable game state so it falls back to the initial state
    _current_editable_game_state = None
    
    return jsonify({
        'success': True,
        'message': 'Game reset to initial position'
    }) 


@api_bp.route('/analyze_game', methods=['POST'])
@require_session
def analyze_game():
    """Analyze a complete game for blunders and insights."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No request data provided'}), 400
        
        # Validate required fields
        if 'game_data' not in data:
            return jsonify({'success': False, 'error': 'Missing game_data field'}), 400
        
        request_model = GameAnalysisRequest(**data)
        
        game_data = request_model.game_data
        moves = game_data.get('moves', [])
        analysis_results = []
        
        print(f"DEBUG: Analyzing game with {len(moves)} moves")
        
        for i, move_data in enumerate(moves):
            # Get position before move
            position = move_data.get('position_before', 'initial')
            
            # Analyze position
            try:
                analysis = analyze_position_internal(position, move_data['player'], request_model.analysis_depth)
                
                # Calculate blunder severity
                actual_move_score = analysis.get('move_scores', {}).get(str(move_data['move']), 0)
                best_move_score = analysis.get('best_score', 0)
                blunder_severity = best_move_score - actual_move_score
                
                analysis_results.append({
                    'move_index': i,
                    'player': move_data['player'],
                    'move': move_data['move'],
                    'position': position,
                    'analysis': analysis,
                    'blunder_severity': blunder_severity,
                    'is_blunder': blunder_severity >= 3.0
                })
                
                print(f"DEBUG: Move {i+1} - Blunder severity: {blunder_severity:.2f}")
                
            except Exception as e:
                print(f"DEBUG: Error analyzing move {i+1}: {e}")
                analysis_results.append({
                    'move_index': i,
                    'player': move_data['player'],
                    'move': move_data['move'],
                    'position': position,
                    'analysis': None,
                    'blunder_severity': 0,
                    'is_blunder': False,
                    'error': str(e)
                })
        
        # Calculate game summary
        blunders = [r for r in analysis_results if r.get('is_blunder', False)]
        total_blunder_severity = sum(r.get('blunder_severity', 0) for r in analysis_results)
        avg_blunder_severity = total_blunder_severity / len(analysis_results) if analysis_results else 0
        
        summary = {
            'total_moves': len(moves),
            'blunder_count': len(blunders),
            'blunder_percentage': (len(blunders) / len(moves)) * 100 if moves else 0,
            'average_blunder_severity': avg_blunder_severity,
            'worst_blunder': max((r.get('blunder_severity', 0) for r in analysis_results), default=0),
            'players': game_data.get('players', ['Player 1', 'Player 2']),
            'game_result': game_data.get('result', {})
        }
        
        return jsonify({
            'success': True,
            'analysis_results': analysis_results,
            'summary': summary
        })
        
    except ValidationError as e:
        return jsonify({'success': False, 'error': f'Invalid request: {str(e)}'}), 400
    except Exception as e:
        return jsonify({'success': False, 'error': f'Failed to analyze game: {str(e)}'}), 500


@api_bp.route('/upload_game_log', methods=['POST'])
@require_session
def upload_game_log():
    """Upload and parse a game log file."""
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({'success': False, 'error': 'No request data provided'}), 400
        
        # Validate required fields
        if 'game_format' not in data:
            return jsonify({'success': False, 'error': 'Missing game_format field'}), 400
        if 'game_content' not in data:
            return jsonify({'success': False, 'error': 'Missing game_content field'}), 400
        
        request_model = GameLogUploadRequest(**data)
        
        # Parse game log based on format
        try:
            game_data = parse_game_log(request_model.game_content, request_model.game_format)
        except ValueError as e:
            return jsonify({'success': False, 'error': f'Invalid game format: {str(e)}'}), 400
        
        # Store in database for later analysis
        game_id = f"game_{int(time.time())}_{random.randint(1000, 9999)}"
        
        # Store game data in database
        if not current_app.database:
            return jsonify({'success': False, 'error': 'Database not available'}), 503
        
        try:
            with current_app.database.get_connection() as conn:
                conn.execute("""
                    INSERT INTO game_analyses (game_id, players, total_moves, game_data, created_at)
                    VALUES (?, ?, ?, ?, ?)
                """, (
                    game_id,
                    json.dumps(game_data.get('players', [])),
                    len(game_data.get('moves', [])),
                    json.dumps(game_data),
                    time.time()
                ))
                conn.commit()
        except Exception as e:
            print(f"DEBUG: Error storing game data: {e}")
            return jsonify({'success': False, 'error': f'Failed to store game data: {str(e)}'}), 500
        
        return jsonify({
            'success': True,
            'game_id': game_id,
            'parsed_data': game_data
        })
        
    except ValidationError as e:
        return jsonify({'success': False, 'error': f'Invalid request: {str(e)}'}), 400
    except Exception as e:
        print(f"DEBUG: Exception in upload_game_log: {e}")
        return jsonify({'success': False, 'error': f'Failed to upload game log: {str(e)}'}), 500


@api_bp.route('/game_analysis/<game_id>', methods=['GET'])
@require_session
def get_game_analysis(game_id: str):
    """Get analysis results for a specific game."""
    try:
        if not current_app.database:
            return jsonify({'error': 'Database not available'}), 503
        
        with current_app.database.get_connection() as conn:
            result = conn.execute("""
                SELECT game_data, analysis_data, created_at
                FROM game_analyses 
                WHERE game_id = ?
            """, (game_id,)).fetchone()
        
        if not result:
            return jsonify({'success': False, 'error': 'Game not found'}), 404
        
        game_data = json.loads(result[0])
        analysis_data = json.loads(result[1]) if result[1] else None
        created_at = result[2]
        
        return jsonify({
            'success': True,
            'game_id': game_id,
            'game_data': game_data,
            'game_analysis': analysis_data,
            'created_at': created_at
        })
        
    except Exception as e:
        return jsonify({'error': f'Failed to get game analysis: {str(e)}'}), 500


@api_bp.route('/game_analyses', methods=['GET'])
@require_session
def search_game_analyses():
    """Search for game analyses."""
    try:
        # Parse query parameters
        player_names = request.args.getlist('player_names')
        min_blunders = request.args.get('min_blunders', type=int)
        max_blunders = request.args.get('max_blunders', type=int)
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        
        if not current_app.database:
            return jsonify({'error': 'Database not available'}), 503
        
        with current_app.database.get_connection() as conn:
            # Build query
            query = "SELECT game_id, players, total_moves, blunder_count, created_at FROM game_analyses WHERE 1=1"
            params = []
            
            if min_blunders is not None:
                query += " AND blunder_count >= ?"
                params.append(min_blunders)
            
            if max_blunders is not None:
                query += " AND blunder_count <= ?"
                params.append(max_blunders)
            
            query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
            params.extend([limit, offset])
            
            results = conn.execute(query, params).fetchall()
        
        games = []
        for row in results:
            games.append({
                'game_id': row[0],
                'players': json.loads(row[1]),
                'total_moves': row[2],
                'blunder_count': row[3],
                'created_at': row[4]
            })
        
        return jsonify({
            'success': True,
            'game_analyses': games,
            'total': len(games)
        })
        
    except Exception as e:
        return jsonify({'error': f'Failed to search game analyses: {str(e)}'}), 500


# D6: Opening Explorer endpoints
@api_bp.route('/similar_positions', methods=['POST'])
@require_session
def find_similar_positions():
    """Find positions similar to the given position."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No request data provided'}), 400
        
        # Validate required fields
        if 'fen_string' not in data:
            return jsonify({'success': False, 'error': 'Missing fen_string field'}), 400
        
        request_model = SimilarPositionRequest(**data)
        
        if not current_app.database:
            return jsonify({'success': False, 'error': 'Database not available'}), 503
        
        # Get position hash
        position_hash = hash_position(request_model.fen_string)
        
        # Find similar positions
        similar_positions = find_similar_positions_internal(
            position_hash, 
            request_model.similarity_threshold, 
            request_model.limit
        )
        
        return jsonify({
            'success': True,
            'similar_positions': similar_positions
        })
        
    except ValidationError as e:
        return jsonify({'success': False, 'error': f'Invalid request: {str(e)}'}), 400
    except Exception as e:
        print(f"DEBUG: Exception in find_similar_positions: {e}")
        return jsonify({'success': False, 'error': f'Failed to find similar positions: {str(e)}'}), 500


@api_bp.route('/popular_continuations', methods=['POST'])
@require_session
def get_popular_continuations():
    """Get popular continuations for a position."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No request data provided'}), 400
        
        # Validate required fields
        if 'fen_string' not in data:
            return jsonify({'success': False, 'error': 'Missing fen_string field'}), 400
        
        request_model = ContinuationRequest(**data)
        
        continuations = get_popular_continuations_internal(
            request_model.fen_string, 
            request_model.limit
        )
        
        # Check if position exists in database
        if not current_app.database:
            return jsonify({'success': False, 'error': 'Database not available'}), 503
        
        with current_app.database.get_connection() as conn:
            position_exists = conn.execute("""
                SELECT id FROM position_database WHERE fen_string = ?
            """, (request_model.fen_string,)).fetchone()
        
        if not position_exists:
            return jsonify({'success': False, 'error': 'Position not found'}), 404
        
        return jsonify({
            'success': True,
            'continuations': continuations
        })
        
    except ValidationError as e:
        return jsonify({'success': False, 'error': f'Invalid request: {str(e)}'}), 400
    except Exception as e:
        print(f"DEBUG: Exception in get_popular_continuations: {e}")
        return jsonify({'success': False, 'error': f'Failed to get continuations: {str(e)}'}), 500


@api_bp.route('/add_to_database', methods=['POST'])
@require_session
def add_position_to_database():
    """Add a position to the opening database."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'No request data provided'}), 400
        
        # Validate required fields
        if 'fen_string' not in data:
            return jsonify({'success': False, 'error': 'Missing fen_string field'}), 400
        
        request_model = PositionDatabaseRequest(**data)
        
        result = add_position_to_database_internal(
            request_model.fen_string,
            request_model.metadata,
            request_model.frequency
        )
        
        return jsonify({
            'success': True,
            'position_id': result['position_id'],
            'action': result['action']
        })
        
    except ValidationError as e:
        return jsonify({'success': False, 'error': f'Invalid request: {str(e)}'}), 400
    except Exception as e:
        print(f"DEBUG: Exception in add_position_to_database: {e}")
        return jsonify({'success': False, 'error': f'Failed to add position: {str(e)}'}), 500


def analyze_position_internal(fen_string: str, agent_id: int, depth: int = 3) -> Dict[str, Any]:
    """Internal function to analyze a position."""
    try:
        # Parse position
        state = parse_fen_string(fen_string)
        
        # Get legal moves
        from core.azul_move_generator import FastMoveGenerator
        generator = FastMoveGenerator()
        legal_moves = generator.generate_moves_fast(state, agent_id)
        
        # Analyze with alpha-beta search
        from core.azul_search import AzulAlphaBetaSearch
        searcher = AzulAlphaBetaSearch()
        
        start_time = time.time()
        result = searcher.search(state, depth, agent_id)
        search_time = time.time() - start_time
        
        # Format move scores
        move_scores = {}
        for move in legal_moves:
            move_key = f"{move.source_id}_{move.tile_type}_{move.pattern_line_dest}_{move.num_to_pattern_line}_{move.num_to_floor_line}"
            move_scores[move_key] = 0  # Placeholder - would need to evaluate each move
        
        return {
            'best_move': format_move(result.best_move) if result.best_move else None,
            'best_score': result.best_score,
            'search_time': search_time,
            'nodes_searched': result.nodes_searched,
            'depth_reached': result.depth_reached,
            'move_scores': move_scores
        }
        
    except Exception as e:
        print(f"DEBUG: Error in analyze_position_internal: {e}")
        return {
            'best_move': None,
            'best_score': 0,
            'search_time': 0,
            'nodes_searched': 0,
            'depth_reached': 0,
            'move_scores': {},
            'error': str(e)
        }


def parse_game_log(content: str, format_type: str) -> Dict[str, Any]:
    """Parse game log content based on format."""
    if format_type == 'json':
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            raise ValueError(f"Invalid JSON format: {content}")
    elif format_type == 'text':
        return parse_text_game_log(content)
    else:
        raise ValueError(f"Unsupported game format: {format_type}")


def parse_text_game_log(content: str) -> Dict[str, Any]:
    """Parse plain text game log format."""
    lines = content.split('\n')
    game_info = {}
    moves = []
    
    for line in lines:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
            
        # Parse game info
        if line.startswith('Game:'):
            game_info['players'] = line.replace('Game:', '').strip().split(' vs ')
        elif line.startswith('Date:'):
            game_info['date'] = line.replace('Date:', '').strip()
        elif line.startswith('Result:'):
            game_info['result'] = line.replace('Result:', '').strip()
        elif line.startswith('1.') or line.startswith('2.') or line.startswith('3.') or line.startswith('4.') or line.startswith('5.'):
            # Parse move
            parts = line.split(':', 1)
            if len(parts) == 2:
                move_num = int(parts[0].replace('.', ''))
                move_desc = parts[1].strip()
                
                # Parse move description (simplified)
                move_data = parse_move_description(move_desc)
                if move_data:
                    moves.append({
                        'player': (move_num - 1) % 2,  # Alternate players
                        'move': move_data,
                        'description': move_desc,
                        'position_before': 'initial',  # Would need to reconstruct
                        'position_after': 'initial'    # Would need to reconstruct
                    })
    
    return {
        'players': game_info.get('players', ['Player 1', 'Player 2']),
        'date': game_info.get('date', ''),
        'result': game_info.get('result', ''),
        'moves': moves
    }


def parse_move_description(desc: str) -> Optional[Dict[str, Any]]:
    """Parse a move description into move data."""
    desc = desc.lower()
    
    # Extract tile color
    tile_colors = {'blue': 0, 'yellow': 1, 'red': 2, 'black': 3, 'white': 4}
    tile_type = None
    for color, tile_id in tile_colors.items():
        if color in desc:
            tile_type = tile_id
            break
    
    if tile_type is None:
        return None
    
    # Extract source (factory or center)
    source_id = -1  # Default to center
    if 'factory' in desc:
        # Extract factory number
        import re
        factory_match = re.search(r'factory (\d+)', desc)
        if factory_match:
            source_id = int(factory_match.group(1))
    
    # Extract destination
    pattern_line_dest = -1
    if 'pattern line' in desc:
        import re
        line_match = re.search(r'pattern line (\d+)', desc)
        if line_match:
            pattern_line_dest = int(line_match.group(1))
    
    return {
        'source_id': source_id,
        'tile_type': tile_type,
        'pattern_line_dest': pattern_line_dest,
        'num_to_pattern_line': 1,
        'num_to_floor_line': 0
    }


# D6: Opening Explorer helper functions
def hash_position(fen_string: str) -> str:
    """Create a hash for a position."""
    # Simple hash based on FEN string
    import hashlib
    return hashlib.md5(fen_string.encode()).hexdigest()[:16]


def find_similar_positions_internal(position_hash: str, threshold: float, limit: int) -> List[Dict[str, Any]]:
    """Find positions similar to the given position hash."""
    try:
        from flask import current_app
        if not current_app.database:
            return []
        
        # Get all positions from database
        with current_app.database.get_connection() as conn:
            results = conn.execute("""
                SELECT fen_string, frequency, metadata, created_at
                FROM position_database
                ORDER BY frequency DESC
                LIMIT ?
            """, (limit * 10,)).fetchall()  # Get more to filter by similarity
        
        similar_positions = []
        for row in results:
            fen_string = row[0]
            frequency = row[1]
            metadata = json.loads(row[2]) if row[2] else {}
            created_at = row[3]
            
            # Calculate similarity
            similarity = calculate_position_similarity(position_hash, hash_position(fen_string))
            
            if similarity >= threshold:
                similar_positions.append({
                    'fen_string': fen_string,
                    'frequency': frequency,
                    'similarity': similarity,
                    'metadata': metadata,
                    'created_at': created_at
                })
        
        # Sort by similarity and limit
        similar_positions.sort(key=lambda x: x['similarity'], reverse=True)
        return similar_positions[:limit]
        
    except Exception as e:
        print(f"DEBUG: Error finding similar positions: {e}")
        return []


def get_popular_continuations_internal(fen_string: str, limit: int) -> List[Dict[str, Any]]:
    """Get popular continuations for a position."""
    try:
        from flask import current_app
        if not current_app.database:
            return []
        
        # Get continuations for this position
        with current_app.database.get_connection() as conn:
            results = conn.execute("""
                SELECT pc.move_data, pc.frequency, pc.win_rate
                FROM position_continuations pc
                JOIN position_database pd ON pc.position_id = pd.id
                WHERE pd.fen_string = ?
                ORDER BY pc.frequency DESC
                LIMIT ?
            """, (fen_string, limit)).fetchall()
        
        continuations = []
        for row in results:
            move_data = json.loads(row[0])
            frequency = row[1]
            win_rate = row[2]
            
            continuations.append({
                'move': move_data,
                'frequency': frequency,
                'win_rate': win_rate,
                'description': format_move_description(move_data)
            })
        
        return continuations
        
    except Exception as e:
        print(f"DEBUG: Error getting continuations: {e}")
        return []


def add_position_to_database_internal(fen_string: str, metadata: Optional[Dict[str, Any]], frequency: int) -> Dict[str, Any]:
    """Add a position to the opening database."""
    try:
        from flask import current_app
        if not current_app.database:
            raise Exception("Database not available")
        
        # Check if position already exists
        with current_app.database.get_connection() as conn:
            existing = conn.execute("""
                SELECT id, frequency FROM position_database WHERE fen_string = ?
            """, (fen_string,)).fetchone()
            
            if existing:
                # Update frequency
                new_frequency = existing[1] + frequency
                conn.execute("""
                    UPDATE position_database 
                    SET frequency = ?, metadata = ?
                    WHERE id = ?
                """, (new_frequency, json.dumps(metadata or {}), existing[0]))
                conn.commit()
                return {
                    'position_id': existing[0],
                    'action': 'updated',
                    'new_frequency': new_frequency
                }
            else:
                # Insert new position
                result = conn.execute("""
                    INSERT INTO position_database (fen_string, frequency, metadata, created_at)
                    VALUES (?, ?, ?, ?)
                """, (fen_string, frequency, json.dumps(metadata or {}), time.time()))
                position_id = result.lastrowid
                conn.commit()
                return {
                    'position_id': position_id,
                    'action': 'created'
                }
        
    except Exception as e:
        print(f"DEBUG: Error adding position to database: {e}")
        raise e


def calculate_position_similarity(hash1: str, hash2: str) -> float:
    """Calculate similarity between two position hashes."""
    # Simple similarity based on hash comparison
    # In practice, this would be more sophisticated
    matches = 0
    for i in range(min(len(hash1), len(hash2))):
        if hash1[i] == hash2[i]:
            matches += 1
    return matches / max(len(hash1), len(hash2))


# Neural Training Request Models
class NeuralTrainingRequest(BaseModel):
    """Request model for neural training."""
    config: str = 'small'  # 'small', 'medium', 'large'
    modelSize: Optional[str] = None  # Frontend sends this field name
    device: str = 'cpu'  # 'cpu', 'cuda'
    epochs: int = 5
    samples: int = 500
    batch_size: int = 16
    learning_rate: float = 0.001
    
    def __init__(self, **data):
        super().__init__(**data)
        # Handle field name mismatch between frontend and backend
        if self.modelSize and not data.get('config'):
            self.config = self.modelSize


class NeuralEvaluationRequest(BaseModel):
    """Request model for neural evaluation."""
    model: str = 'models/azul_net_small.pth'
    positions: int = 50
    games: int = 20
    device: str = 'cpu'


class NeuralConfigRequest(BaseModel):
    """Request model for neural configuration."""
    config: Optional[str] = None
    device: Optional[str] = None
    epochs: Optional[int] = None
    samples: Optional[int] = None
    batch_size: Optional[int] = None
    learning_rate: Optional[float] = None


# Neural Training API Endpoints
@api_bp.route('/neural/train', methods=['POST'])
def start_neural_training():
    """Start neural network training in background with enhanced monitoring."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Validate request data
        try:
            training_request = NeuralTrainingRequest(**data)
        except ValidationError as e:
            return jsonify({'error': 'Invalid training configuration', 'details': e.errors()}), 400
        
        # Check if neural components are available
        try:
            from neural.train import TrainingConfig, AzulNetTrainer
        except ImportError:
            return jsonify({
                'error': 'Neural training not available',
                'message': 'PyTorch and neural components are not installed. Install with: pip install torch'
            }), 503
        
        # Generate session ID
        session_id = str(uuid.uuid4())
        
        # Create database session only (no in-memory session)
        from core.azul_database import NeuralTrainingSession
        db_session = NeuralTrainingSession(
            session_id=session_id,
            status='starting',
            progress=0,
            start_time=datetime.now(),
            config=training_request.dict(),
            logs=['Training session created'],
            error=None,
            results=None,
            loss_history=[],
            epoch_history=[],
            timestamp_history=[],
            cpu_usage=[],
            memory_usage=[],
            gpu_usage=[],
            estimated_total_time=None,
            current_epoch=0,
            total_epochs=training_request.epochs,
            created_at=datetime.now(),
            metadata={
                'device': training_request.device,
                'config_size': training_request.config,
                'epochs': training_request.epochs,
                'samples': training_request.samples,
                'batch_size': training_request.batch_size,
                'learning_rate': training_request.learning_rate
            }
        )
        db.save_neural_training_session(db_session)
        
        # Start training in background thread
        def train_in_background():
            try:
                # Update status to running
                db_session = db.get_neural_training_session(session_id)
                if not db_session:
                    return
                
                db_session.status = 'running'
                db_session.logs.append('Training started')
                db.save_neural_training_session(db_session)
                
                # Configuration based on size
                if training_request.config == 'small':
                    hidden_size = 64
                    num_layers = 2
                elif training_request.config == 'medium':
                    hidden_size = 128
                    num_layers = 3
                else:  # large
                    hidden_size = 256
                    num_layers = 4
                
                # Create training config
                train_config = TrainingConfig(
                    batch_size=training_request.batch_size,
                    learning_rate=training_request.learning_rate,
                    num_epochs=training_request.epochs,
                    num_samples=training_request.samples,
                    hidden_size=hidden_size,
                    num_layers=num_layers,
                    device=training_request.device
                )
                
                # Create custom trainer with progress callbacks
                class MonitoredTrainer(AzulNetTrainer):
                    def __init__(self, config, session_id, db):
                        super().__init__(config)
                        self.session_id = session_id
                        self.db = db
                        self.epoch_count = 0
                    
                    def _train_epoch(self, states, policy_targets, value_targets):
                        """Override to add progress monitoring."""
                        # Get current session from database
                        db_session = self.db.get_neural_training_session(self.session_id)
                        if not db_session:
                            raise InterruptedError("Session not found")
                        
                        # Check if stop requested
                        if db_session.status == 'stopped':
                            raise InterruptedError("Training stopped by user")
                        
                        # Get resource usage
                        resources = get_process_resources()
                        db_session.cpu_usage.append(resources['cpu_percent'])
                        db_session.memory_usage.append(resources['memory_percent'])
                        
                        # Train epoch
                        loss = super()._train_epoch(states, policy_targets, value_targets)
                        
                        # Update progress
                        self.epoch_count += 1
                        progress = min(80, (self.epoch_count / train_config.num_epochs) * 80)
                        
                        # Update database session with progress
                        db_session.progress = int(progress)
                        db_session.current_epoch = self.epoch_count
                        db_session.loss_history.append(loss)
                        db_session.epoch_history.append(self.epoch_count)
                        db_session.timestamp_history.append(datetime.now().isoformat())
                        
                        # Save progress to database
                        self.db.save_neural_training_session(db_session)
                        
                        return loss
                
                # Train model with monitoring
                trainer = MonitoredTrainer(train_config, session_id, db)
                losses = trainer.train()
                
                # Get final session and update with completion
                db_session = db.get_neural_training_session(session_id)
                if db_session:
                    db_session.logs.append(f'Training completed with {len(losses)} epochs')
                    db_session.progress = 80
                    db.save_neural_training_session(db_session)
                
                # Evaluate
                eval_results = trainer.evaluate(num_samples=50)
                if db_session:
                    db_session.logs.append('Evaluation completed')
                    db_session.progress = 90
                    db.save_neural_training_session(db_session)
                
                # Save model
                import os
                os.makedirs("models", exist_ok=True)
                model_path = f"models/azul_net_{training_request.config}.pth"
                trainer.save_model(model_path)
                
                # Final update with completed status
                if db_session:
                    db_session.logs.append(f'Model saved to {model_path}')
                    db_session.progress = 100
                    db_session.status = 'completed'
                    db_session.end_time = datetime.now()
                    db_session.results = {
                        'final_loss': losses[-1] if losses else 0.0,
                        'evaluation_error': eval_results.get('avg_value_error', 0.0),
                        'model_path': model_path,
                        'config': training_request.config,
                        'epochs': training_request.epochs,
                        'samples': training_request.samples
                    }
                    
                    # Update metadata with final results
                    if not db_session.metadata:
                        db_session.metadata = {}
                    db_session.metadata.update({
                        'final_loss': losses[-1] if losses else 0.0,
                        'evaluation_error': eval_results.get('avg_value_error', 0.0),
                        'model_path': model_path
                    })
                    
                    db.save_neural_training_session(db_session)
                
            except InterruptedError:
                # Update database with stopped status
                db_session = db.get_neural_training_session(session_id)
                if db_session:
                    db_session.status = 'stopped'
                    db_session.logs.append('Training stopped by user')
                    db_session.end_time = datetime.now()
                    db.save_neural_training_session(db_session)
                
            except Exception as e:
                # Update database with failed status
                db_session = db.get_neural_training_session(session_id)
                if db_session:
                    db_session.status = 'failed'
                    db_session.error = str(e)
                    db_session.logs.append(f'Error: {str(e)}')
                    db_session.end_time = datetime.now()
                    db.save_neural_training_session(db_session)
        
        # Start background thread
        thread = threading.Thread(target=train_in_background)
        thread.daemon = True
        thread.start()
        
        return jsonify({
            'success': True,
            'message': 'Training started in background',
            'session_id': session_id,
            'status': 'starting'
        })
        
    except Exception as e:
        return jsonify({
            'error': 'Internal server error',
            'message': str(e)
        }), 500


@api_bp.route('/neural/status/<session_id>', methods=['GET'])
def get_training_status(session_id):
    """Get enhanced training status for a session with loss history and resource monitoring."""
    try:
        # Get session from database
        db_session = db.get_neural_training_session(session_id)
        if not db_session:
            return jsonify({'error': 'Session not found'}), 404
        
        # Convert database session to API response format
        response_data = {
            'session_id': db_session.session_id,
            'status': db_session.status,
            'progress': db_session.progress,
            'start_time': db_session.start_time.isoformat() if db_session.start_time else None,
            'end_time': db_session.end_time.isoformat() if db_session.end_time else None,
            'config': db_session.config if isinstance(db_session.config, dict) else {},
            'logs': db_session.logs if isinstance(db_session.logs, list) else [],
            'error': db_session.error,
            'results': db_session.results if isinstance(db_session.results, dict) else None,
            'metadata': db_session.metadata if isinstance(db_session.metadata, dict) else {},
            # Enhanced monitoring fields
            'loss_history': db_session.loss_history if db_session.loss_history else [],
            'epoch_history': db_session.epoch_history if db_session.epoch_history else [],
            'timestamp_history': db_session.timestamp_history if db_session.timestamp_history else [],
            'cpu_usage': db_session.cpu_usage if db_session.cpu_usage else [],
            'memory_usage': db_session.memory_usage if db_session.memory_usage else [],
            'gpu_usage': db_session.gpu_usage if db_session.gpu_usage else [],
            'estimated_total_time': db_session.estimated_total_time,
            'current_epoch': db_session.current_epoch,
            'total_epochs': db_session.total_epochs
        }
        
        return jsonify(response_data)
        
    except Exception as e:
        return jsonify({
            'error': 'Failed to get session status',
            'message': str(e)
        }), 500


@api_bp.route('/neural/stop/<session_id>', methods=['POST'])
def stop_training(session_id):
    """Stop training for a session."""
    try:
        # Get session from database
        db_session = db.get_neural_training_session(session_id)
        if not db_session:
            return jsonify({'error': 'Session not found'}), 404
        
        # Update session status to stopped
        db_session.status = 'stopped'
        db_session.logs.append('Stop requested - training will terminate gracefully')
        
        # Save updated session to database
        db.save_neural_training_session(db_session)
        
        return jsonify({
            'success': True,
            'message': 'Training stop requested',
            'session_id': session_id
        })
        
    except Exception as e:
        return jsonify({
            'error': 'Failed to stop training',
            'message': str(e)
        }), 500


@api_bp.route('/neural/evaluate', methods=['POST'])
def evaluate_neural_model():
    """Evaluate a trained neural model."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Validate request data
        try:
            eval_request = NeuralEvaluationRequest(**data)
        except ValidationError as e:
            return jsonify({'error': 'Invalid evaluation configuration', 'details': e.errors()}), 400
        
        # Check if neural components are available
        try:
            from neural.evaluate import EvaluationConfig, AzulModelEvaluator
        except ImportError:
            return jsonify({
                'error': 'Neural evaluation not available',
                'message': 'PyTorch and neural components are not installed. Install with: pip install torch'
            }), 503
        
        # Check if model exists
        import os
        if not os.path.exists(eval_request.model):
            return jsonify({
                'error': 'Model not found',
                'message': f'Model file {eval_request.model} does not exist'
            }), 404
        
        # Create evaluation configuration
        config = EvaluationConfig(
            num_positions=eval_request.positions,
            num_games=eval_request.games,
            search_time=0.5,
            max_rollouts=50,
            model_path=eval_request.model,
            device=eval_request.device,
            compare_heuristic=True,
            compare_random=True
        )
        
        # Generate session ID for this evaluation
        import uuid
        session_id = f"eval_{uuid.uuid4().hex[:8]}"
        
        # Create evaluation session
        # Convert config to dict and remove non-serializable fields
        config_dict = asdict(config)
        if 'progress_callback' in config_dict:
            del config_dict['progress_callback']
        evaluation_sessions[session_id] = {
            'status': 'running',
            'progress': 0,
            'start_time': time.time(),
            'config': config_dict,
            'results': None,
            'error': None
        }
        
        # Run evaluation in background
        def evaluate_in_background():
            try:
                def progress_callback(percent):
                    evaluation_sessions[session_id]['progress'] = percent
                config.progress_callback = progress_callback
                evaluator = AzulModelEvaluator(config)
                results = evaluator.evaluate_model()
                evaluation_sessions[session_id].update({
                    'status': 'completed',
                    'progress': 100,
                    'results': results,
                    'end_time': time.time()
                })
            except Exception as e:
                evaluation_sessions[session_id].update({
                    'status': 'failed',
                    'error': str(e),
                    'end_time': time.time()
                })
        
        # Start background thread
        import threading
        thread = threading.Thread(target=evaluate_in_background)
        thread.daemon = True
        thread.start()
        
        return jsonify({
            'success': True,
            'message': 'Evaluation started in background',
            'session_id': session_id,
            'status_url': f'/api/v1/neural/evaluate/status/{session_id}'
        })
            
    except Exception as e:
        return jsonify({
            'error': 'Internal server error',
            'message': str(e)
        }), 500


@api_bp.route('/neural/evaluate/status/<session_id>', methods=['GET'])
def get_evaluation_status(session_id):
    """Get evaluation status for a specific session."""
    try:
        if session_id not in evaluation_sessions:
            return jsonify({
                'error': 'Session not found',
                'message': f'Evaluation session {session_id} does not exist'
            }), 404
        
        session = evaluation_sessions[session_id]
        
        # Calculate elapsed time
        elapsed_time = time.time() - session['start_time']
        
        response = {
            'session_id': session_id,
            'status': session['status'],
            'progress': session['progress'],
            'elapsed_time': round(elapsed_time, 2),
            'start_time': session['start_time']
        }
        
        if session['status'] == 'completed':
            response['results'] = session['results']
            response['end_time'] = session['end_time']
            response['total_time'] = round(session['end_time'] - session['start_time'], 2)
        elif session['status'] == 'failed':
            response['error'] = session['error']
            response['end_time'] = session['end_time']
            response['total_time'] = round(session['end_time'] - session['start_time'], 2)
        
        return jsonify(response)
        
    except Exception as e:
        return jsonify({
            'error': 'Failed to get evaluation status',
            'message': str(e)
        }), 500


@api_bp.route('/neural/models', methods=['GET'])
def get_available_models():
    """Get list of available trained models."""
    try:
        import os
        import glob
        
        models_dir = "models"
        if not os.path.exists(models_dir):
            return jsonify({
                'models': [],
                'message': 'No models directory found'
            })
        
        # Find all .pth files
        model_files = glob.glob(os.path.join(models_dir, "*.pth"))
        models = []
        
        for model_path in model_files:
            filename = os.path.basename(model_path)
            size = os.path.getsize(model_path)
            models.append({
                'name': filename,
                'path': model_path,
                'size_bytes': size,
                'size_mb': round(size / (1024 * 1024), 2)
            })
        
        return jsonify({
            'models': models,
            'count': len(models)
        })
        
    except Exception as e:
        return jsonify({
            'error': 'Failed to get models',
            'message': str(e)
        }), 500


@api_bp.route('/neural/config', methods=['GET'])
def get_neural_config():
    """Get current neural training configuration."""
    try:
        # Return default configuration
        config = {
            'config': 'small',
            'device': 'cpu',
            'epochs': 5,
            'samples': 500,
            'batch_size': 16,
            'learning_rate': 0.001,
            'available_configs': ['small', 'medium', 'large'],
            'available_devices': ['cpu', 'cuda']
        }
        
        return jsonify(config)
        
    except Exception as e:
        return jsonify({
            'error': 'Failed to get configuration',
            'message': str(e)
        }), 500


@api_bp.route('/neural/config', methods=['POST'])
def save_neural_config():
    """Save neural training configuration."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Validate request data
        try:
            config_request = NeuralConfigRequest(**data)
        except ValidationError as e:
            return jsonify({'error': 'Invalid configuration', 'details': e.errors()}), 400
        
        # In a real implementation, this would save to a config file or database
        # For now, just return success
        return jsonify({
            'success': True,
            'message': 'Configuration saved successfully'
        })
        
    except Exception as e:
        return jsonify({
            'error': 'Failed to save configuration',
            'message': str(e)
        }), 500


@api_bp.route('/neural/status', methods=['GET'])
def get_neural_status():
    """Get neural training status."""
    try:
        # Check if neural components are available
        neural_available = False
        pytorch_version = None
        cuda_available = False
        
        try:
            import torch
            pytorch_version = torch.__version__
            
            # Try to import neural modules
            try:
                from neural.train import TrainingConfig, AzulNetTrainer
                neural_available = True
            except ImportError as e:
                print(f"Warning: Neural modules not available: {e}")
                neural_available = False
            
            # Check CUDA availability (this can sometimes cause issues)
            try:
                cuda_available = torch.cuda.is_available()
            except Exception as e:
                print(f"Warning: CUDA check failed: {e}")
                cuda_available = False
                
        except ImportError as e:
            print(f"Warning: PyTorch not available: {e}")
            neural_available = False
        except Exception as e:
            print(f"Warning: PyTorch initialization failed: {e}")
            neural_available = False
        
        # Check available models
        import os
        import glob
        models_dir = "models"
        model_count = 0
        try:
            if os.path.exists(models_dir):
                model_files = glob.glob(os.path.join(models_dir, "*.pth"))
                model_count = len(model_files)
        except Exception as e:
            print(f"Warning: Model directory check failed: {e}")
            model_count = 0
        
        status = {
            'neural_available': neural_available,
            'model_count': model_count,
            'pytorch_version': pytorch_version,
            'cuda_available': cuda_available
        }
        
        return jsonify(status)
        
    except Exception as e:
        print(f"Error in get_neural_status: {e}")
        return jsonify({
            'error': 'Failed to get status',
            'message': str(e)
        }), 500


def calculate_position_similarity(hash1: str, hash2: str) -> float:
    """Calculate similarity between two position hashes."""
    # Simple similarity based on hash comparison
    # In practice, this would be more sophisticated
    matches = 0
    for i in range(min(len(hash1), len(hash2))):
        if hash1[i] == hash2[i]:
            matches += 1
    return matches / max(len(hash1), len(hash2))


def get_system_resources():
    """Get current system resource usage."""
    try:
        cpu_percent = psutil.cpu_percent(interval=0.1)
        memory = psutil.virtual_memory()
        memory_percent = memory.percent
        
        # Try to get GPU usage if available
        gpu_percent = None
        try:
            import torch
            if torch.cuda.is_available():
                gpu_percent = torch.cuda.memory_allocated() / torch.cuda.max_memory_allocated() * 100
        except ImportError:
            pass
        
        return {
            'cpu_percent': cpu_percent,
            'memory_percent': memory_percent,
            'memory_used_gb': memory.used / (1024**3),
            'memory_total_gb': memory.total / (1024**3),
            'gpu_percent': gpu_percent
        }
    except Exception as e:
        return {
            'cpu_percent': 0.0,
            'memory_percent': 0.0,
            'memory_used_gb': 0.0,
            'memory_total_gb': 0.0,
            'gpu_percent': None,
            'error': str(e)
        }


def get_process_resources():
    """Get current process resource usage."""
    try:
        process = psutil.Process()
        cpu_percent = process.cpu_percent()
        memory_info = process.memory_info()
        memory_percent = process.memory_percent()
        
        return {
            'cpu_percent': cpu_percent,
            'memory_percent': memory_percent,
            'memory_used_mb': memory_info.rss / (1024**2),
            'threads': process.num_threads()
        }
    except Exception as e:
        return {
            'cpu_percent': 0.0,
            'memory_percent': 0.0,
            'memory_used_mb': 0.0,
            'threads': 0,
            'error': str(e)
        }


@api_bp.route('/neural/sessions', methods=['GET'])
def get_all_training_sessions():
    """Get all training sessions from database."""
    try:
        # Get query parameters for filtering
        status = request.args.get('status')
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        
        # Get sessions from database
        db_sessions = db.get_all_neural_training_sessions(
            status=status,
            limit=limit,
            offset=offset
        )
        
        # Convert database sessions to API response format
        sessions = []
        for db_session in db_sessions:
            session_data = {
                'session_id': db_session.session_id,
                'status': db_session.status,
                'progress': db_session.progress,
                'start_time': db_session.created_at.isoformat() if db_session.created_at else None,
                'end_time': db_session.updated_at.isoformat() if db_session.updated_at else None,
                'config': json.loads(db_session.config) if db_session.config else {},
                'logs': json.loads(db_session.logs) if db_session.logs else [],
                'error': db_session.error,
                'results': json.loads(db_session.results) if db_session.results else None,
                'metadata': json.loads(db_session.metadata) if db_session.metadata else {}
            }
            sessions.append(session_data)
        
        # Get total count for pagination
        all_sessions = db.get_all_neural_training_sessions()
        total_count = len(all_sessions)
        active_count = len([s for s in all_sessions if s.status in ['starting', 'running']])
        
        return jsonify({
            'sessions': sessions,
            'count': len(sessions),
            'total_count': total_count,
            'active_count': active_count,
            'limit': limit,
            'offset': offset
        })
        
    except Exception as e:
        return jsonify({
            'error': 'Failed to get sessions',
            'message': str(e)
        }), 500


@api_bp.route('/neural/sessions/<session_id>', methods=['DELETE'])
def delete_training_session(session_id):
    """Delete a training session from database."""
    try:
        # Check if session exists
        db_session = db.get_neural_training_session(session_id)
        if not db_session:
            return jsonify({'error': 'Session not found'}), 404
        
        # Delete session from database
        success = db.delete_neural_training_session(session_id)
        if not success:
            return jsonify({'error': 'Failed to delete session'}), 500
        
        return jsonify({
            'success': True,
            'message': 'Session deleted',
            'session_id': session_id
        })
        
    except Exception as e:
        return jsonify({
            'error': 'Failed to delete session',
            'message': str(e)
        }), 500


@api_bp.route('/neural/evaluation-sessions', methods=['GET'])
def get_all_evaluation_sessions():
    """Get all active evaluation sessions."""
    try:
        sessions = []
        for session_id, session in evaluation_sessions.items():
            # Calculate elapsed time
            elapsed_time = None
            if 'start_time' in session:
                start_time = session['start_time']
                if isinstance(start_time, (int, float)):
                    elapsed_time = time.time() - start_time
                else:
                    # Handle string timestamps
                    try:
                        import datetime
                        start_dt = datetime.datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                        elapsed_time = (datetime.datetime.now() - start_dt).total_seconds()
                    except:
                        elapsed_time = 0
            
            session_data = {
                'session_id': session_id,
                'status': session.get('status', 'unknown'),
                'progress': session.get('progress', 0),
                'start_time': session.get('start_time'),
                'end_time': session.get('end_time'),
                'elapsed_time': elapsed_time,
                'config': session.get('config'),
                'error': session.get('error'),
                'results': session.get('results')
            }
            sessions.append(session_data)
        
        return jsonify({
            'sessions': sessions,
            'count': len(sessions),
            'active_count': len([s for s in sessions if s['status'] in ['starting', 'running']])
        })
        
    except Exception as e:
        return jsonify({
            'error': 'Failed to get evaluation sessions',
            'message': str(e)
        }), 500


@api_bp.route('/neural/evaluation-sessions/<session_id>', methods=['DELETE'])
def delete_evaluation_session(session_id):
    """Delete an evaluation session."""
    if session_id not in evaluation_sessions:
        return jsonify({'error': 'Session not found'}), 404
    
    del evaluation_sessions[session_id]
    
    return jsonify({
        'success': True,
        'message': 'Evaluation session deleted',
        'session_id': session_id
    })


# New API endpoints for Part 2.1.4: Historical Data and Configuration Management

@api_bp.route('/neural/history', methods=['GET'])
def get_training_history():
    """Get historical training data with advanced filtering and sorting."""
    try:
        # Get query parameters
        status = request.args.get('status')
        config_size = request.args.get('config_size')  # small, medium, large
        device = request.args.get('device')  # cpu, cuda
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        sort_by = request.args.get('sort_by', 'created_at')  # created_at, progress, status
        sort_order = request.args.get('sort_order', 'desc')  # asc, desc
        
        # Get sessions from database with filtering
        db_sessions = db.get_all_neural_training_sessions(
            status=status,
            limit=limit,
            offset=offset
        )
        
        # Apply additional filtering
        filtered_sessions = []
        for session in db_sessions:
            # Parse metadata for additional filtering
            metadata = json.loads(session.metadata) if session.metadata else {}
            
            # Filter by config size
            if config_size and metadata.get('config_size') != config_size:
                continue
                
            # Filter by device
            if device and metadata.get('device') != device:
                continue
                
            # Filter by date range
            if date_from and session.created_at:
                from datetime import datetime
                try:
                    date_from_dt = datetime.fromisoformat(date_from.replace('Z', '+00:00'))
                    if session.created_at < date_from_dt:
                        continue
                except:
                    pass
                    
            if date_to and session.created_at:
                from datetime import datetime
                try:
                    date_to_dt = datetime.fromisoformat(date_to.replace('Z', '+00:00'))
                    if session.created_at > date_to_dt:
                        continue
                except:
                    pass
            
            filtered_sessions.append(session)
        
        # Sort sessions
        if sort_by == 'created_at':
            filtered_sessions.sort(key=lambda x: x.created_at or datetime.min, reverse=(sort_order == 'desc'))
        elif sort_by == 'progress':
            filtered_sessions.sort(key=lambda x: x.progress or 0, reverse=(sort_order == 'desc'))
        elif sort_by == 'status':
            filtered_sessions.sort(key=lambda x: x.status or '', reverse=(sort_order == 'desc'))
        
        # Convert to API response format
        sessions = []
        for db_session in filtered_sessions:
            session_data = {
                'session_id': db_session.session_id,
                'status': db_session.status,
                'progress': db_session.progress,
                'start_time': db_session.created_at.isoformat() if db_session.created_at else None,
                'end_time': db_session.updated_at.isoformat() if db_session.updated_at else None,
                'config': json.loads(db_session.config) if db_session.config else {},
                'logs': json.loads(db_session.logs) if db_session.logs else [],
                'error': db_session.error,
                'results': json.loads(db_session.results) if db_session.results else None,
                'metadata': json.loads(db_session.metadata) if db_session.metadata else {}
            }
            sessions.append(session_data)
        
        return jsonify({
            'sessions': sessions,
            'count': len(sessions),
            'total_count': len(filtered_sessions),
            'filters': {
                'status': status,
                'config_size': config_size,
                'device': device,
                'date_from': date_from,
                'date_to': date_to
            },
            'sorting': {
                'sort_by': sort_by,
                'sort_order': sort_order
            },
            'pagination': {
                'limit': limit,
                'offset': offset
            }
        })
        
    except Exception as e:
        return jsonify({
            'error': 'Failed to get training history',
            'message': str(e)
        }), 500


@api_bp.route('/neural/configurations', methods=['GET'])
def get_neural_configurations():
    """Get all saved neural training configurations."""
    try:
        # Get query parameters
        is_default = request.args.get('is_default', type=bool)
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        
        # Get configurations from database
        db_configs = db.get_neural_configurations(
            is_default=is_default
        )
        
        # Convert to API response format
        configurations = []
        for db_config in db_configs:
            config_data = {
                'config_id': db_config.config_id,
                'name': db_config.name,
                'description': db_config.description,
                'is_default': db_config.is_default,
                'config': json.loads(db_config.config) if db_config.config else {},
                'metadata': json.loads(db_config.metadata) if db_config.metadata else {},
                'created_at': db_config.created_at.isoformat() if db_config.created_at else None,
                'updated_at': db_config.updated_at.isoformat() if db_config.updated_at else None
            }
            configurations.append(config_data)
        
        return jsonify({
            'configurations': configurations,
            'count': len(configurations),
            'filters': {
                'is_default': is_default
            },
            'pagination': {
                'limit': limit,
                'offset': offset
            }
        })
        
    except Exception as e:
        return jsonify({
            'error': 'Failed to get configurations',
            'message': str(e)
        }), 500


@api_bp.route('/neural/configurations', methods=['POST'])
def save_neural_configuration():
    """Save a new neural training configuration."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Validate required fields
        required_fields = ['name', 'config']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        # Create configuration object
        from core.azul_database import NeuralConfiguration
        db_config = NeuralConfiguration(
            config_id=str(uuid.uuid4()),
            name=data['name'],
            description=data.get('description', ''),
            is_default=data.get('is_default', False),
            config=json.dumps(data['config']),
            metadata=json.dumps(data.get('metadata', {}))
        )
        
        # Save to database
        success = db.save_neural_configuration(db_config)
        if not success:
            return jsonify({'error': 'Failed to save configuration'}), 500
        
        return jsonify({
            'success': True,
            'message': 'Configuration saved',
            'config_id': db_config.config_id
        })
        
    except Exception as e:
        return jsonify({
            'error': 'Failed to save configuration',
            'message': str(e)
        }), 500


@api_bp.route('/neural/configurations/<config_id>', methods=['PUT'])
def update_neural_configuration(config_id):
    """Update an existing neural training configuration."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Get existing configuration
        db_config = db.get_neural_configuration(config_id)
        if not db_config:
            return jsonify({'error': 'Configuration not found'}), 404
        
        # Update fields
        if 'name' in data:
            db_config.name = data['name']
        if 'description' in data:
            db_config.description = data['description']
        if 'is_default' in data:
            db_config.is_default = data['is_default']
        if 'config' in data:
            db_config.config = json.dumps(data['config'])
        if 'metadata' in data:
            db_config.metadata = json.dumps(data['metadata'])
        
        # Save updated configuration
        success = db.save_neural_configuration(db_config)
        if not success:
            return jsonify({'error': 'Failed to update configuration'}), 500
        
        return jsonify({
            'success': True,
            'message': 'Configuration updated',
            'config_id': config_id
        })
        
    except Exception as e:
        return jsonify({
            'error': 'Failed to update configuration',
            'message': str(e)
        }), 500


@api_bp.route('/neural/configurations/<config_id>', methods=['DELETE'])
def delete_neural_configuration(config_id):
    """Delete a neural training configuration."""
    try:
        # Check if configuration exists
        db_config = db.get_neural_configuration(config_id)
        if not db_config:
            return jsonify({'error': 'Configuration not found'}), 404
        
        # Delete configuration
        success = db.delete_neural_configuration(config_id)
        if not success:
            return jsonify({'error': 'Failed to delete configuration'}), 500
        
        return jsonify({
            'success': True,
            'message': 'Configuration deleted',
            'config_id': config_id
        })
        
    except Exception as e:
        return jsonify({
            'error': 'Failed to delete configuration',
            'message': str(e)
        }), 500


@api_bp.route('/neural/models', methods=['GET'])
def get_neural_models():
    """Get all saved neural models with metadata."""
    try:
        # Get query parameters
        architecture = request.args.get('architecture')
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        
        # Get models from database
        db_models = db.get_neural_models(
            architecture=architecture
        )
        
        # Convert to API response format
        models = []
        for db_model in db_models:
            model_data = {
                'model_id': db_model.model_id,
                'name': db_model.name,
                'architecture': db_model.architecture,
                'file_path': db_model.file_path,
                'training_session_id': db_model.training_session_id,
                'metadata': json.loads(db_model.metadata) if db_model.metadata else {},
                'created_at': db_model.created_at.isoformat() if db_model.created_at else None,
                'updated_at': db_model.updated_at.isoformat() if db_model.updated_at else None
            }
            models.append(model_data)
        
        return jsonify({
            'models': models,
            'count': len(models),
            'filters': {
                'architecture': architecture
            },
            'pagination': {
                'limit': limit,
                'offset': offset
            }
        })
        
    except Exception as e:
        return jsonify({
            'error': 'Failed to get models',
            'message': str(e)
        }), 500