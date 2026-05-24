from backend.clustering import cluster_articles

def test_clustering():
    articles = [
        # Group 1: iPhone price hikes
        {
            "id": 1,
            "title": "MacRumors: iPhone 18 Pro price set to increase by $100",
            "summary": "According to industry analyst Ming-Chi Kuo, Apple is planning a $100 price hike for the upcoming iPhone 18 Pro models due to increased TSMC node costs."
        },
        {
            "id": 2,
            "title": "9to5Mac: iPhone 18 Pro pricing rumored to go up",
            "summary": "Rumors from Asia suggest TSMC manufacturing costs will force Apple to raise retail prices for the next-generation iPhone 18 Pro line by $100."
        },
        # Group 2: MacBook OLED rumors
        {
            "id": 3,
            "title": "MacBook Pro with OLED screen delayed to 2027",
            "summary": "A new supply chain report claims Apple's transition to OLED displays for the MacBook Pro series has been pushed back from 2026 to 2027."
        },
        {
            "id": 4,
            "title": "Apple's OLED MacBook Pro reportedly facing delays",
            "summary": "Samsung Display is experiencing low yields, causing Apple to delay its highly anticipated OLED MacBook Pro launch to 2027, says report."
        },
        # Group 3: Unique article (iOS 19 features)
        {
            "id": 5,
            "title": "Apple Intelligence features coming in iOS 19",
            "summary": "We outline the major upgrades planned for Siri and system-wide intelligence utilities in the upcoming iOS 19 preview this fall."
        }
    ]

    print("Running text clustering test...")
    groups = cluster_articles(articles, threshold=0.35)
    
    print(f"Clustering completed. Found {len(groups)} clusters.")
    for idx, group in enumerate(groups):
        print(f"\n--- Story Cluster {idx + 1} ---")
        for art in group:
            print(f"  [{art['id']}] {art['title']}")
            
    # Assert we found exactly 3 groups
    assert len(groups) == 3, f"Expected 3 clusters, but got {len(groups)}"
    print("\n✅ Text clustering tests passed perfectly!")

if __name__ == "__main__":
    test_clustering()
