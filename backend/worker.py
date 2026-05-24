import time
import os
import sys
from backend.database import Database
from backend.sync import SyncEngine

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    db = Database(db_path=os.path.join(base_dir, "../reader.db"))
    sync_engine = SyncEngine(db)
    
    print("=" * 60)
    print("   APPLE INTELLIGENCE LOCAL RSS AGGREGATOR - TASK WORKER")
    print("=" * 60)
    print("Running interactively in foreground session.")
    print("Automatically polling for new articles to consolidate.")
    print("Press CTRL+C to stop the worker daemon.")
    print("-" * 60)
    
    while True:
        try:
            # Check if there are any unaggregated articles fetched in the last 6 hours
            unaggregated = db.get_unaggregated_articles_in_window(hours=6)
            if unaggregated:
                print(f"\n[Worker] Detected {len(unaggregated)} new unaggregated articles.")
                print("[Worker] Initiating Apple Intelligence consolidation loop...")
                
                # Execute consolidation with LLM active
                sync_engine.sync_all(run_llm=True)
                
                print("[Worker] Consolidation complete! Listening for updates...")
            
        except KeyboardInterrupt:
            print("\n[Worker] Stopping Terminal Task Worker. Goodbye!")
            sys.exit(0)
        except Exception as e:
            print(f"\n[Worker Error] Exception in main loop: {e}")
            
        time.sleep(3.5) # Poll database every 3.5 seconds

if __name__ == "__main__":
    main()
